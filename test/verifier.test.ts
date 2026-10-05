import { test } from "node:test";
import assert from "node:assert/strict";
import { bytesToBase64url, canonicalJson, randomBytes, sha256Hex, utf8 } from "../src/shared/crypto.ts";
import { bindingNonce, exportPublicKeys, signResult } from "../src/shared/attestation.ts";
import { DOMAIN } from "../src/shared/constants.ts";
import { walletSetNullifier } from "../src/shared/nullifiers.ts";
import { MockAttestationProvider } from "../src/enclave/attestation-provider.ts";
import { EnclaveKeyManager } from "../src/enclave/keys.ts";
import {
  AttestationVerifier,
  VerificationError,
  checkTokenClaims,
} from "../src/verifier/index.ts";
import { verifyPkiToken } from "../src/verifier/jwt.ts";
import { RegistrationService, RegistrationConflict } from "../src/verifier/service.ts";
import { InMemoryNullifierStore } from "../src/verifier/store.ts";
import { SixFigsVerification } from "../src/verifier/nestjs.ts";
import type {
  RegistrationResultBody,
  SignedRegistration,
  WalletNullifierEntry,
} from "../src/shared/types.ts";

function walletEntry(label: string): WalletNullifierEntry {
  return { walletNullifier: sha256Hex(label), family: "evm", chainId: 1 };
}

async function makeSigned(overrides: Partial<RegistrationResultBody> = {}): Promise<{
  signed: SignedRegistration;
  canonical: string;
}> {
  const attestation = new MockAttestationProvider({});
  const manager = new EnclaveKeyManager(attestation, "legacy-v1", {});
  const keys = manager.keys;
  const { signingPublicKey, keyId } = exportPublicKeys(keys);

  const walletNullifiers = overrides.walletNullifiers ?? [walletEntry("wallet-a")];
  const identityNullifier = overrides.identityNullifier ?? walletSetNullifier(walletNullifiers);

  const body: RegistrationResultBody = {
    v: 1,
    policyVersion: "test-policy",
    tier: 2,
    tierLabel: "$300k+",
    tierFloorMicroUsd: "300000000000",
    nextTierFloorMicroUsd: "500000000000",
    portfolioBand: "300k-500k",
    topAssets: ["ETH", "SOL"],
    disclosure: "category",
    allocation: [{ category: "stable", bps: 4200 }],
    walletNullifiers,
    identityNullifier,
    createdAt: Date.now(),
    expiresAt: Date.now() + 3_600_000,
    nonce: "request-nonce",
    nullifierScheme: "legacy-v1",
    ...overrides,
  };
  const canonical = canonicalJson(body);
  const signature = signResult(keys, canonical);
  const payloadHash = sha256Hex(`${DOMAIN.enclaveResult}|${canonical}`);
  const nonce = bindingNonce(keys.signingPublic, payloadHash);
  const token = await attestation.getToken({
    audience: "6figs-registration",
    nonces: [nonce],
    tokenType: "OIDC",
  });

  return {
    signed: {
      v: 1,
      body,
      signature,
      enclavePublicKey: signingPublicKey,
      keyId,
      attestationToken: token,
      provider: "mock",
    },
    canonical,
  };
}

function verifier(allowMock = true, policy: Record<string, unknown> = {}) {
  return new AttestationVerifier({
    audience: "6figs-registration",
    allowMock,
    policy: {
      allowedImageDigests: [],
      allowedProjects: [],
      allowedNullifierSchemes: ["legacy-v1", "keyed-v1"],
      ...policy,
    },
  });
}

test("verifier accepts a well-formed signed registration", async () => {
  const { signed } = await makeSigned();
  const body = await verifier().verifyRegistration(signed);
  assert.equal(body.tier, 2);
  assert.equal(body.identityNullifier, walletSetNullifier([walletEntry("wallet-a")]));
});

test("verifier rejects malformed top assets and wallet labels", async () => {
  const tooMany = await makeSigned({ topAssets: ["A", "B", "C", "D"] });
  await assert.rejects(
    () => verifier().verifyRegistration(tooMany.signed),
    (e: unknown) => e instanceof VerificationError && e.code === "bad_assets",
  );
  const longSymbol = await makeSigned({ topAssets: ["USDCUSDCUSDC"] });
  await assert.rejects(
    () => verifier().verifyRegistration(longSymbol.signed),
    (e: unknown) => e instanceof VerificationError && e.code === "bad_assets",
  );
  const badLabel = await makeSigned({
    walletNullifiers: [{ ...walletEntry("wallet-a"), label: "x".repeat(33) }],
  });
  await assert.rejects(
    () => verifier().verifyRegistration(badLabel.signed),
    (e: unknown) => e instanceof VerificationError && e.code === "bad_label",
  );
});

test("verifier rejects a nullifier scheme outside the allowlist", async () => {
  const { signed } = await makeSigned({ nullifierScheme: "keyed-v1" });
  await assert.rejects(
    () => verifier(true, { allowedNullifierSchemes: ["legacy-v1"] }).verifyRegistration(signed),
    (e: unknown) => e instanceof VerificationError && e.code === "scheme_not_allowed",
  );
});

test("verifier refuses an empty nullifier scheme allowlist", async () => {
  const { signed } = await makeSigned();
  await assert.rejects(
    () => verifier(true, { allowedNullifierSchemes: [] }).verifyRegistration(signed),
    (e: unknown) => e instanceof VerificationError && e.code === "policy_not_configured",
  );
});

test("verifier rejects a tampered body", async () => {
  const { signed } = await makeSigned();
  signed.body.tier = 4;
  await assert.rejects(
    () => verifier().verifyRegistration(signed),
    (e: unknown) => e instanceof VerificationError && e.code === "bad_signature",
  );
});

test("verifier rejects an identity that is not the wallet set commitment", async () => {
  const { signed } = await makeSigned({ identityNullifier: "ff".repeat(32) });
  await assert.rejects(
    () => verifier().verifyRegistration(signed),
    (e: unknown) => e instanceof VerificationError && e.code === "bad_identity",
  );
});

test("verifier rejects a token bound to a different result", async () => {
  const a = await makeSigned();
  const b = await makeSigned({ walletNullifiers: [walletEntry("wallet-b")] });
  a.signed.attestationToken = b.signed.attestationToken;
  await assert.rejects(
    () => verifier().verifyRegistration(a.signed),
    (e: unknown) => e instanceof VerificationError && e.code === "nonce_mismatch",
  );
});

test("verifier rejects mock attestation when not allowed", async () => {
  const { signed } = await makeSigned();
  await assert.rejects(
    () => verifier(false).verifyRegistration(signed),
    (e: unknown) => e instanceof VerificationError && e.code === "mock_not_allowed",
  );
});

test("verifier rejects an expired result", async () => {
  const { signed } = await makeSigned({
    createdAt: Date.now() - 2 * 3_600_000,
    expiresAt: Date.now() - 3_600_000,
  });
  await assert.rejects(
    () => verifier().verifyRegistration(signed),
    (e: unknown) => e instanceof VerificationError && e.code === "result_expired",
  );
});

test("verifier enforces the expected request nonce", async () => {
  const { signed } = await makeSigned();
  await assert.rejects(
    () => verifier().verifyRegistration(signed, { expectedNonce: "other" }),
    (e: unknown) => e instanceof VerificationError && e.code === "nonce_mismatch",
  );
});

test("verifier rejects an unknown policy version", async () => {
  const { signed } = await makeSigned();
  await assert.rejects(
    () => verifier().verifyRegistration(signed, { expectedPolicyVersion: "nope" }),
    (e: unknown) => e instanceof VerificationError && e.code === "policy_mismatch",
  );
});

test("verifier refuses empty image and project allowlists", () => {
  const payload = {
    iss: "https://confidentialcomputing.googleapis.com",
    aud: "6figs-registration",
    exp: Math.floor(Date.now() / 1000) + 3_600,
    swname: "CONFIDENTIAL_SPACE",
    dbgstat: "disabled-since-boot",
    submods: {
      container: { image_digest: "sha256:abc" },
      gce: { project_id: "prod", zone: "us-central1-a" },
    },
  };
  const empty = {
    audience: "6figs-registration",
    policy: {
      allowedImageDigests: [],
      allowedProjects: [],
      allowedNullifierSchemes: ["legacy-v1"],
    },
  };
  assert.throws(
    () => checkTokenClaims(payload, empty),
    (e: unknown) => e instanceof VerificationError && e.code === "policy_not_configured",
  );
  const configured = {
    audience: "6figs-registration",
    policy: {
      allowedImageDigests: ["sha256:abc"],
      allowedProjects: ["prod"],
      allowedNullifierSchemes: ["legacy-v1"],
    },
  };
  checkTokenClaims(payload, configured);
  const wrongDigest = {
    audience: "6figs-registration",
    policy: {
      allowedImageDigests: ["sha256:other"],
      allowedProjects: ["prod"],
      allowedNullifierSchemes: ["legacy-v1"],
    },
  };
  assert.throws(
    () => checkTokenClaims(payload, wrongDigest),
    (e: unknown) => e instanceof VerificationError && e.code === "image_not_allowed",
  );
});

test("PKI verification requires a root and fails closed without one", () => {
  const header = bytesToBase64url(
    utf8(JSON.stringify({ alg: "RS256", x5c: ["QUJD"] })),
  );
  const body = bytesToBase64url(utf8(JSON.stringify({})));
  const token = `${header}.${body}.QUJD`;
  assert.throws(() => verifyPkiToken(token, ""), /root certificate is required/);
});

test("verifier fails closed when the PKI root cannot be loaded", async () => {
  const { signed } = await makeSigned();
  const header = bytesToBase64url(utf8(JSON.stringify({ alg: "RS256", x5c: ["QUJD"] })));
  const body = bytesToBase64url(utf8(JSON.stringify({})));
  signed.attestationToken = `${header}.${body}.QUJD`;
  signed.provider = "confidential-space";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
  try {
    await assert.rejects(
      () => verifier().verifyRegistration(signed),
      (e: unknown) =>
        e instanceof VerificationError && e.code === "pki_root_unavailable",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("nestjs facade logs verification outcomes by code only", async () => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const six = SixFigsVerification.inMemory({
    audience: "6figs-registration",
    policy: {
      allowedImageDigests: [],
      allowedProjects: [],
      allowedNullifierSchemes: ["legacy-v1"],
    },
    allowMock: true,
    logger: {
      warn: (message: string) => warnings.push(message),
      error: (message: string) => errors.push(message),
    },
  });

  const { signed } = await makeSigned();
  await six.submit(signed);
  assert.equal(warnings.length, 0);
  assert.equal(errors.length, 0);

  const tampered = await makeSigned();
  tampered.signed.body.tier = 4;
  await assert.rejects(() => six.submit(tampered.signed));
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0]!.includes("bad_signature"));
  assert.equal(errors.length, 0);
});

test("registration service is idempotent for the same wallet set", async () => {
  const { signed } = await makeSigned();
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });
  const record = await service.submit(signed);
  assert.equal(record.tier, 2);
  const again = await service.submit(signed);
  assert.equal(again.identityNullifier, record.identityNullifier);
});

test("registration service allows adding a wallet when every enrolled wallet re-signs", async () => {
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });

  const first = await makeSigned({ walletNullifiers: [walletEntry("wallet-a")] });
  const firstRecord = await service.submit(first.signed);

  const grown = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b")],
  });
  const grownRecord = await service.submit(grown.signed);

  assert.notEqual(grownRecord.identityNullifier, firstRecord.identityNullifier);
  assert.equal(await store.getIdentity(firstRecord.identityNullifier), null);
  assert.equal((await store.listWallets(grownRecord.identityNullifier)).length, 2);
});

test("registration service refuses to drop an enrolled wallet", async () => {
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });

  const full = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b")],
  });
  await service.submit(full.signed);

  const reduced = await makeSigned({ walletNullifiers: [walletEntry("wallet-a")] });
  await assert.rejects(
    () => service.submit(reduced.signed),
    (e: unknown) => e instanceof RegistrationConflict,
  );
});

test("verifier accepts a well-formed removal without any claimed previous identity", async () => {
  const { signed } = await makeSigned({
    removedWalletNullifiers: [walletEntry("wallet-b")],
  });
  const body = await verifier().verifyRegistration(signed);
  assert.equal(body.removedWalletNullifiers?.length, 1);
});

test("verifier rejects a wallet that is both kept and removed", async () => {
  const { signed } = await makeSigned({
    removedWalletNullifiers: [walletEntry("wallet-a")],
  });
  await assert.rejects(
    () => verifier().verifyRegistration(signed),
    (e: unknown) => e instanceof VerificationError && e.code === "bad_transition",
  );
});

test("registration service rejects removal results", async () => {
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });

  const first = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b")],
  });
  const firstRecord = await service.submit(first.signed);

  const removal = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a")],
    removedWalletNullifiers: [walletEntry("wallet-b")],
  });
  await assert.rejects(
    () => service.submit(removal.signed),
    (e: unknown) => e instanceof RegistrationConflict,
  );
  assert.equal((await store.listWallets(firstRecord.identityNullifier)).length, 2);
});

test("registration service applies an addition bound to the previous identity", async () => {
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });

  const first = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b")],
  });
  const firstRecord = await service.submit(first.signed);

  const addition = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b"), walletEntry("wallet-c")],
    previousIdentityNullifier: firstRecord.identityNullifier,
    addedWalletNullifiers: [walletEntry("wallet-c")],
    nextEscrowBlob: { v: 1, epk: "ephemeral", iv: "nonce", ct: "ciphertext" },
  });
  const record = await service.submit(addition.signed);

  const bound = await store.listWallets(record.identityNullifier);
  assert.equal(bound.length, 3);
  assert.equal(await store.getIdentity(firstRecord.identityNullifier), null);
});

test("registration service rejects an addition that drops a stored wallet", async () => {
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });

  const first = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b")],
  });
  const firstRecord = await service.submit(first.signed);

  const bad = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b"), walletEntry("wallet-c")],
    previousIdentityNullifier: walletSetNullifier([walletEntry("wallet-a")]),
    addedWalletNullifiers: [walletEntry("wallet-b"), walletEntry("wallet-c")],
    nextEscrowBlob: { v: 1, epk: "ephemeral", iv: "nonce", ct: "ciphertext" },
  });
  await assert.rejects(
    () => service.submit(bad.signed),
    (e: unknown) => e instanceof RegistrationConflict,
  );
  assert.equal((await store.listWallets(firstRecord.identityNullifier)).length, 2);
});

test("verifier rejects a partial addition triple", async () => {
  const partial = await makeSigned({
    previousIdentityNullifier: "ab".repeat(32),
  });
  await assert.rejects(
    () => verifier().verifyRegistration(partial.signed),
    (e: unknown) => e instanceof VerificationError && e.code === "bad_transition",
  );
});

test("verifier rejects an addition that leaves the identity unchanged", async () => {
  const entries = [walletEntry("wallet-a"), walletEntry("wallet-b")];
  const noop = await makeSigned({
    walletNullifiers: entries,
    previousIdentityNullifier: walletSetNullifier(entries),
    addedWalletNullifiers: [walletEntry("wallet-b")],
    nextEscrowBlob: { v: 1, epk: "ephemeral", iv: "nonce", ct: "ciphertext" },
  });
  await assert.rejects(
    () => verifier().verifyRegistration(noop.signed),
    (e: unknown) => e instanceof VerificationError && e.code === "bad_transition",
  );
});

test("registration service rejects a removal that omits an enrolled wallet", async () => {
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });

  const first = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b"), walletEntry("wallet-c")],
  });
  await service.submit(first.signed);

  const removal = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a")],
    removedWalletNullifiers: [walletEntry("wallet-b")],
  });
  await assert.rejects(
    () => service.submit(removal.signed),
    (e: unknown) => e instanceof RegistrationConflict,
  );
});

test("registration service rejects removing a wallet that was never enrolled", async () => {
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });

  const first = await makeSigned({ walletNullifiers: [walletEntry("wallet-a")] });
  await service.submit(first.signed);

  const removal = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a")],
    removedWalletNullifiers: [walletEntry("wallet-b")],
  });
  await assert.rejects(
    () => service.submit(removal.signed),
    (e: unknown) => e instanceof RegistrationConflict,
  );
});

test("registration service serializes concurrent transitions to one coherent state", async () => {
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });

  const a = await makeSigned({ walletNullifiers: [walletEntry("wallet-a")] });
  const ab = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b")],
  });
  const outcomes = await Promise.allSettled([service.submit(a.signed), service.submit(ab.signed)]);
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  assert.ok(fulfilled.length >= 1, "at least one transition must win");

  const owners = await store.getWalletOwners([
    walletEntry("wallet-a").walletNullifier,
    walletEntry("wallet-b").walletNullifier,
  ]);
  const ownerIdentities = new Set(owners.values());
  assert.equal(ownerIdentities.size, 1);
  const surviving = [...ownerIdentities][0]!;
  assert.ok(await store.getIdentity(surviving));
});

test("registration service rejects a set spanning two identities", async () => {
  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({ verifier: verifier(), store });

  const a = await makeSigned({ walletNullifiers: [walletEntry("wallet-a")] });
  const b = await makeSigned({ walletNullifiers: [walletEntry("wallet-b")] });
  await service.submit(a.signed);
  await service.submit(b.signed);

  const merged = await makeSigned({
    walletNullifiers: [walletEntry("wallet-a"), walletEntry("wallet-b")],
  });
  await assert.rejects(
    () => service.submit(merged.signed),
    (e: unknown) => e instanceof RegistrationConflict,
  );
});

test("verifier hello binds the enclosure key", async () => {
  const attestation = new MockAttestationProvider({});
  const manager = new EnclaveKeyManager(attestation, "legacy-v1", {});
  const hello = await manager.hello("test-policy");
  await verifier().verifyHello(hello);
  hello.keyId = "00".repeat(32);
  await assert.rejects(() => verifier().verifyHello(hello));
});

test("verifier hello rejects a substituted encryption key", async () => {
  const attestation = new MockAttestationProvider({});
  const manager = new EnclaveKeyManager(attestation, "legacy-v1", {});
  const hello = await manager.hello("test-policy");
  hello.encryptionPublicKey = bytesToBase64url(randomBytes(32));
  await assert.rejects(() => verifier().verifyHello(hello));
});

test("verifier hello rejects a substituted escrow key", async () => {
  const attestation = new MockAttestationProvider({});
  const manager = new EnclaveKeyManager(attestation, "legacy-v1", {});
  const hello = await manager.hello("test-policy");
  hello.escrowPublicKey = bytesToBase64url(randomBytes(32));
  await assert.rejects(() => verifier().verifyHello(hello));
});