import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "../src/shared/crypto.ts";
import { MockAttestationProvider } from "../src/enclave/attestation-provider.ts";
import {
  EnvEscrowKeyProvider,
  GcpKmsEscrowKeyProvider,
  NoneEscrowKeyProvider,
  selectEscrowKeyProvider,
} from "../src/enclave/key-provider.ts";
import { EnclaveKeyManager } from "../src/enclave/keys.ts";
import { createEnclaveServer } from "../src/enclave/server.ts";
import { AttestationVerifier, VerificationError } from "../src/verifier/index.ts";
import { verifyHello } from "../src/client/attestation.ts";

test("provider selection honors KMS, env, production refusal, and none", () => {
  const attestation = new MockAttestationProvider({});
  assert.equal(selectEscrowKeyProvider(attestation, {}).kind, "none");
  assert.equal(
    selectEscrowKeyProvider(attestation, { SIXFIGS_ESCROW_KEY: "ab".repeat(32) }).kind,
    "env",
  );
  assert.throws(
    () =>
      selectEscrowKeyProvider(attestation, {
        SIXFIGS_ESCROW_KEY: "ab".repeat(32),
        NODE_ENV: "production",
      }),
    /not accepted in production/,
  );
  assert.equal(
    selectEscrowKeyProvider(attestation, {
      SIXFIGS_ESCROW_KEY: "ab".repeat(32),
      NODE_ENV: "production",
      SIXFIGS_ALLOW_ENV_ESCROW_KEY: "1",
    }).kind,
    "env",
  );
  assert.throws(
    () =>
      selectEscrowKeyProvider(attestation, {
        SIXFIGS_KMS_KEY: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
      }),
    /SIXFIGS_KMS_WRAPPED_ESCROW_KEY/,
  );
});

test("env and none providers validate key material", async () => {
  const loaded = await new EnvEscrowKeyProvider("cd".repeat(32)).load();
  assert.equal(loaded.privateKey?.length, 32);
  assert.equal(loaded.provider, "env");
  await assert.rejects(
    () => new EnvEscrowKeyProvider("not-hex").load(),
    /64 hex characters/,
  );
  const none = await new NoneEscrowKeyProvider().load();
  assert.equal(none.privateKey, null);
  assert.equal(none.provider, "none");
});

test("GCP KMS provider unwraps through STS and impersonation", async () => {
  const escrow = randomBytes(32);
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    if (url === "https://sts.googleapis.com/v1/token") {
      return new Response(JSON.stringify({ access_token: "federated-token" }), { status: 200 });
    }
    if (url.includes("iamcredentials.googleapis.com")) {
      return new Response(JSON.stringify({ accessToken: "impersonated-token" }), {
        status: 200,
      });
    }
    if (url.includes("cloudkms.googleapis.com") && url.endsWith(":decrypt")) {
      return new Response(JSON.stringify({ plaintext: Buffer.from(escrow).toString("base64") }), {
        status: 200,
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const kmsKey = "projects/p/locations/l/keyRings/r/cryptoKeys/k";
  const provider = new GcpKmsEscrowKeyProvider({
    kmsKey,
    wrappedKey: randomBytes(48),
    stsAudience:
      "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/pool/providers/provider",
    serviceAccount: "enclave@p.iam.gserviceaccount.com",
    attestation: new MockAttestationProvider({}),
    fetchImpl,
  });
  const loaded = await provider.load();
  assert.deepEqual(loaded.privateKey, escrow);
  assert.equal(loaded.provider, "kms");
  assert.equal(loaded.keyId, kmsKey);

  const stsCall = calls.find((call) => call.url.includes("sts.googleapis.com"))!;
  const stsBody = String(stsCall.init?.body ?? "");
  assert.ok(stsBody.includes("subject_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Ajwt"));

  const kmsCall = calls.find((call) => call.url.includes("cloudkms.googleapis.com"))!;
  const kmsHeaders = kmsCall.init?.headers as unknown as Record<string, string>;
  assert.equal(kmsHeaders.authorization, "Bearer impersonated-token");
  const kmsBody = JSON.parse(String(kmsCall.init?.body)) as {
    ciphertext?: string;
    additionalAuthenticatedData?: string;
  };
  assert.ok(typeof kmsBody.ciphertext === "string" && kmsBody.ciphertext.length > 0);
  assert.equal(kmsBody.additionalAuthenticatedData, undefined);
});

test("GCP KMS provider fails closed on every broken step", async () => {
  const base = {
    kmsKey: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
    wrappedKey: randomBytes(48),
    stsAudience: "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/pr",
    attestation: new MockAttestationProvider({}),
  };
  const stsError = (async () => new Response("denied", { status: 403 })) as typeof fetch;
  await assert.rejects(
    () => new GcpKmsEscrowKeyProvider({ ...base, fetchImpl: stsError }).load(),
    /exchange failed/,
  );

  const stsEmpty = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  await assert.rejects(
    () => new GcpKmsEscrowKeyProvider({ ...base, fetchImpl: stsEmpty }).load(),
    /no access token/,
  );

  const kmsError = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("sts.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    }
    return new Response("boom", { status: 500 });
  }) as typeof fetch;
  await assert.rejects(
    () => new GcpKmsEscrowKeyProvider({ ...base, fetchImpl: kmsError }).load(),
    /KMS decrypt failed/,
  );

  const wrongLength = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("sts.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ plaintext: Buffer.from(randomBytes(16)).toString("base64") }),
      { status: 200 },
    );
  }) as typeof fetch;
  await assert.rejects(
    () => new GcpKmsEscrowKeyProvider({ ...base, fetchImpl: wrongLength }).load(),
    /escrow key must be 32/,
  );
});

test("key manager advertises the loaded KMS provider and boot fails closed", async () => {
  const escrow = randomBytes(32);
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("sts.googleapis.com")) {
      return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    }
    return new Response(JSON.stringify({ plaintext: Buffer.from(escrow).toString("base64") }), {
      status: 200,
    });
  }) as typeof fetch;
  const provider = new GcpKmsEscrowKeyProvider({
    kmsKey: "projects/p/locations/l/keyRings/r/cryptoKeys/k",
    wrappedKey: randomBytes(48),
    stsAudience: "//iam.googleapis.com/projects/1/locations/global/workloadIdentityPools/p/providers/pr",
    attestation: new MockAttestationProvider({}),
    fetchImpl,
  });
  const manager = new EnclaveKeyManager(
    new MockAttestationProvider({}),
    "legacy-v1",
    {},
    provider,
  );
  await manager.ensureEscrowLoaded();
  assert.equal(manager.escrowPersistent, true);
  assert.deepEqual(manager.keys.escrowPrivate, escrow);
  const hello = await manager.hello("test-policy");
  assert.equal(hello.escrowKeyProvider, "kms");
  assert.equal(hello.escrowKeyId, "projects/p/locations/l/keyRings/r/cryptoKeys/k");

  const app = createEnclaveServer({
    env: {
      SIXFIGS_MOCK_ATTESTATION: "1",
      SIXFIGS_DEV_INSECURE_BALANCES: "1",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    attestation: new MockAttestationProvider({}),
    escrowKeyProvider: {
      kind: "kms",
      async load() {
        throw new Error("kms unavailable");
      },
    },
  });
  await assert.rejects(() => app.listen(), /kms unavailable/);
});
test("hello policy can require the kms escrow provider", async () => {
  const manager = new EnclaveKeyManager(new MockAttestationProvider({}), "legacy-v1", {
    SIXFIGS_ESCROW_KEY: "ab".repeat(32),
  });
  const hello = await manager.hello("test-policy");
  assert.equal(hello.escrowKeyProvider, "env");

  const verifier = new AttestationVerifier({
    audience: "6figs-enclave-key",
    allowMock: true,
    policy: {
      allowedImageDigests: [],
      allowedProjects: [],
      allowedNullifierSchemes: ["legacy-v1"],
      requiredEscrowKeyProviders: ["kms"],
    },
  });
  await assert.rejects(
    () => verifier.verifyHello(hello),
    (error: unknown) =>
      error instanceof VerificationError && error.code === "escrow_provider_not_allowed",
  );

  await assert.rejects(
    () =>
      verifyHello(hello, {
        allowMock: true,
        requiredEscrowKeyProviders: ["kms"],
      }),
    /provider env is not allowed/,
  );
});
