import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";
import { bytesToBase64url, utf8 } from "../src/shared/crypto.ts";
import {
  assertAttestationClaims,
  clearJwksCache,
  verifyAttestationToken,
} from "../src/client/attestation.ts";

function signedToken(payload: Record<string, unknown>, privateKey: KeyObject): string {
  const header = bytesToBase64url(utf8(JSON.stringify({ alg: "RS256", kid: "k1" })));
  const body = bytesToBase64url(utf8(JSON.stringify(payload)));
  const signature = createSign("RSA-SHA256").update(`${header}.${body}`).sign(privateKey);
  return `${header}.${body}.${bytesToBase64url(new Uint8Array(signature))}`;
}

const strictPolicy = {
  allowedImageDigests: ["sha256:abc"],
  allowedProjects: ["prod"],
};

const GOOGLE = "https://confidentialcomputing.googleapis.com";

function claims(): Record<string, unknown> {
  return {
    iss: GOOGLE,
    aud: "6figs-registration",
    exp: Math.floor(Date.now() / 1000) + 3_600,
    swname: "CONFIDENTIAL_SPACE",
    dbgstat: "disabled-since-boot",
    submods: {
      container: { image_digest: "sha256:abc" },
      gce: { project_id: "prod", zone: "us-central1-a" },
      confidential_space: { support_attributes: ["STABLE"] },
    },
  };
}

test("browser client rejects attestations when allowlists are missing", () => {
  assert.throws(
    () => assertAttestationClaims(claims(), "6figs-registration", {}),
    /allowedImageDigests/,
  );
  assert.throws(
    () =>
      assertAttestationClaims(claims(), "6figs-registration", {
        allowedImageDigests: ["sha256:abc"],
      }),
    /allowedProjects/,
  );
});

test("browser client accepts a matching policy and rejects a wrong digest", () => {
  assertAttestationClaims(claims(), "6figs-registration", {
    allowedImageDigests: ["sha256:abc"],
    allowedProjects: ["prod"],
    requiredSupportAttributes: ["STABLE"],
  });
  assert.throws(
    () =>
      assertAttestationClaims(claims(), "6figs-registration", {
        allowedImageDigests: ["sha256:other"],
        allowedProjects: ["prod"],
      }),
    /not allowed/,
  );
  assert.throws(
    () => assertAttestationClaims(claims(), "6figs-enclave-key", {
      allowedImageDigests: ["sha256:abc"],
      allowedProjects: ["prod"],
    }),
    /audience/,
  );
});

test("browser client verifies RS256 tokens against pinned JWKS without network", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n?: string; e?: string };
  const token = signedToken(claims(), privateKey);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
  try {
    clearJwksCache();
    await verifyAttestationToken(token, "6figs-registration", {
      ...strictPolicy,
      jwks: { keys: [{ kty: "RSA", kid: "k1", n: jwk.n, e: jwk.e }] },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser client caches fetched JWKS within the window", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" }) as { n?: string; e?: string };
  const token = signedToken(claims(), privateKey);
  const jwksDoc = { keys: [{ kty: "RSA", kid: "k1", n: jwk.n, e: jwk.e }] };
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    calls++;
    const body = String(url).includes("openid-configuration")
      ? { jwks_uri: "https://example.invalid/jwks" }
      : jwksDoc;
    return { ok: true, json: async () => body };
  }) as typeof fetch;
  try {
    clearJwksCache();
    await verifyAttestationToken(token, "6figs-registration", strictPolicy);
    await verifyAttestationToken(token, "6figs-registration", strictPolicy);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearJwksCache();
  }
});

test("browser client fetch timeout fails promptly", async () => {
  const header = bytesToBase64url(utf8(JSON.stringify({ alg: "RS256", kid: "k1" })));
  const body = bytesToBase64url(utf8(JSON.stringify({})));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (( _url: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as typeof fetch;
  try {
    clearJwksCache();
    const start = Date.now();
    await assert.rejects(() =>
      verifyAttestationToken(`${header}.${body}.AAAA`, "6figs-registration", {
        ...strictPolicy,
        fetchTimeoutMs: 50,
      }),
    );
    assert.ok(Date.now() - start < 2_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
