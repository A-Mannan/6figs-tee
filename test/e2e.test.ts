import { test, after } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, randomBytes, utf8 } from "../src/shared/crypto.ts";
import {
  walletEntriesFromAddresses,
  walletSetNullifier,
} from "../src/shared/nullifiers.ts";
import { createEnclaveServer } from "../src/enclave/server.ts";
import { MockAttestationProvider } from "../src/enclave/attestation-provider.ts";
import { StaticPricing } from "../src/enclave/pricing.ts";
import { RegistrationClient, type PreparedRegistration } from "../src/client/register.ts";
import { encryptEscrowBlob } from "../src/client/escrow.ts";
import { RecheckClient } from "../src/client/recheck.ts";
import { AttestationVerifier } from "../src/verifier/index.ts";
import { RegistrationService } from "../src/verifier/service.ts";
import { InMemoryNullifierStore } from "../src/verifier/store.ts";

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function evmAccount(): { privateKey: Uint8Array; address: string } {
  const privateKey = secp256k1.utils.randomPrivateKey();
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  const address = `0x${Buffer.from(keccak_256(publicKey.slice(1)).slice(-20)).toString("hex")}`;
  return { privateKey, address };
}

function signMessage(privateKey: Uint8Array, message: string): string {
  const prefix = `\x19Ethereum Signed Message:\n${utf8(message).length}`;
  const digest = keccak_256(concat(utf8(prefix), utf8(message)));
  const sig = secp256k1.sign(digest, privateKey);
  return Buffer.from(
    concat(sig.toCompactRawBytes(), new Uint8Array([sig.recovery! + 27])),
  ).toString("hex");
}

function signAll(
  prepared: PreparedRegistration,
  accounts: Map<string, Uint8Array>,
): Record<string, string> {
  const signatures: Record<string, string> = {};
  for (const wallet of prepared.wallets) {
    const key = accounts.get(wallet.address.toLowerCase());
    if (!key) throw new Error(`missing account for ${wallet.address}`);
    signatures[`${wallet.family}:${wallet.address.toLowerCase()}`] = signMessage(
      key,
      prepared.message,
    );
  }
  return signatures;
}

test("end-to-end registration through HTTP", async () => {
  const app = createEnclaveServer({
    env: {
      SIXFIGS_MOCK_ATTESTATION: "1",
      SIXFIGS_DEV_INSECURE_BALANCES: "1",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    attestation: new MockAttestationProvider({}),
    pricing: new StaticPricing({}, 3000),
  });
  const { port } = await app.listen();
  after(() => app.server.close());

  const enclaveUrl = `http://127.0.0.1:${port}`;

  // A browser-like client that performs both attestation checks.
  const client = new RegistrationClient({
    enclaveUrl,
    policy: { allowMock: true },
    fetchImpl: fetch,
  });

  const alice = evmAccount();
  const bob = evmAccount();
  const carol = evmAccount();
  const keys = new Map([
    [alice.address.toLowerCase(), alice.privateKey],
    [bob.address.toLowerCase(), bob.privateKey],
    [carol.address.toLowerCase(), carol.privateKey],
  ]);
  const descriptor = (account: { address: string }) => ({
    family: "evm" as const,
    chainId: 1,
    address: account.address,
  });

  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({
    verifier: new AttestationVerifier({
      audience: "6figs-registration",
      allowMock: true,
      policy: {
        allowedImageDigests: [],
        allowedProjects: [],
        allowedNullifierSchemes: ["legacy-v1"],
      },
    }),
    store,
  });

  // First registration: the account is the wallet set.
  const first = client.prepare({ wallets: [descriptor(alice)], disclosure: "category" });
  const signed = await client.submit({
    prepared: first,
    signatures: signAll(first, keys),
  });
  assert.ok(Number.isInteger(signed.body.tier));
  assert.equal(signed.body.identityNullifier.length, 64);
  assert.equal(signed.body.disclosure, "category");
  const record = await service.submit(signed, { requestNonce: first.nonce });
  assert.equal(record.tier, signed.body.tier);

  // Re-registering the same wallet set is the recovery path: same identity.
  const again = client.prepare({ wallets: [descriptor(alice)] });
  const signedAgain = await client.submit({ prepared: again, signatures: signAll(again, keys) });
  assert.equal(signedAgain.body.identityNullifier, signed.body.identityNullifier);
  await service.submit(signedAgain);

  // Adding a wallet keeps the account; every enrolled wallet must re-sign.
  const grown = client.prepare({ wallets: [descriptor(alice), descriptor(bob)] });
  const signedGrown = await client.submit({ prepared: grown, signatures: signAll(grown, keys) });
  const grownRecord = await service.submit(signedGrown);
  assert.notEqual(grownRecord.identityNullifier, record.identityNullifier);
  assert.equal((await store.listWallets(grownRecord.identityNullifier)).length, 2);

  // Merging wallets that belong to two different accounts is refused.
  const carolOnly = client.prepare({ wallets: [descriptor(carol)] });
  const signedCarol = await client.submit({
    prepared: carolOnly,
    signatures: signAll(carolOnly, keys),
  });
  await service.submit(signedCarol);

  const merged = client.prepare({
    wallets: [descriptor(alice), descriptor(bob), descriptor(carol)],
  });
  const signedMerged = await client.submit({ prepared: merged, signatures: signAll(merged, keys) });
  await assert.rejects(() => service.submit(signedMerged));

  // Removal is not a product path: the enclave can still build the result,
  // but the trust boundary refuses to persist it.
  const bobKey = `evm:${bob.address.toLowerCase()}`;
  const removal = client.prepare({
    wallets: [descriptor(alice)],
    remove: [descriptor(bob)],
  });
  const signedRemoval = await client.submit({
    prepared: removal,
    signatures: signAll(removal, keys),
    removalSignatures: {
      [bobKey]: signMessage(bob.privateKey, removal.removalMessages[bobKey]!),
    },
  });
  await assert.rejects(() => service.submit(signedRemoval));
  assert.equal(
    (await store.listWallets(signedGrown.body.identityNullifier)).length,
    2,
    "a rejected removal leaves the stored set untouched",
  );
});

test("end-to-end wallet addition through HTTP uses only the added signature", async () => {
  const escrowKey = randomBytes(32);
  const app = createEnclaveServer({
    env: {
      SIXFIGS_MOCK_ATTESTATION: "1",
      SIXFIGS_DEV_INSECURE_BALANCES: "1",
      SIXFIGS_ESCROW_KEY: bytesToHex(escrowKey),
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    attestation: new MockAttestationProvider({}),
    pricing: new StaticPricing({}, 3000),
  });
  const { port } = await app.listen();
  after(() => app.server.close());

  const enclaveUrl = `http://127.0.0.1:${port}`;
  const client = new RegistrationClient({
    enclaveUrl,
    policy: { allowMock: true },
    fetchImpl: fetch,
  });
  const alice = evmAccount();
  const bob = evmAccount();
  const descriptor = (account: { address: string }) => ({
    family: "evm" as const,
    chainId: 1,
    address: account.address,
  });

  const store = new InMemoryNullifierStore();
  const service = new RegistrationService({
    verifier: new AttestationVerifier({
      audience: "6figs-registration",
      allowMock: true,
      policy: {
        allowedImageDigests: [],
        allowedProjects: [],
        allowedNullifierSchemes: ["legacy-v1"],
      },
    }),
    store,
  });

  const first = client.prepare({ wallets: [descriptor(alice)] });
  const signedFirst = await client.submit({
    prepared: first,
    signatures: { [`evm:${alice.address.toLowerCase()}`]: signMessage(alice.privateKey, first.message) },
  });
  const firstRecord = await service.submit(signedFirst, { requestNonce: first.nonce });

  // The backend hands the browser the stored blob and identity; the browser
  // adds only Bob's signature.
  const hello = await client.hello();
  const escrowBlob = await encryptEscrowBlob(hello.escrowPublicKey, [descriptor(alice)]);
  const addition = client.prepareAddition({
    added: [descriptor(bob)],
    escrowBlob,
    accountIdentityNullifier: firstRecord.identityNullifier,
    nonce: "addition-session-nonce",
  });
  const bobKey = `evm:${bob.address.toLowerCase()}`;
  const signedAddition = await client.submitAddition({
    prepared: addition,
    signatures: { [bobKey]: signMessage(bob.privateKey, addition.addMessages[bobKey]!) },
  });

  assert.equal(signedAddition.body.previousIdentityNullifier, firstRecord.identityNullifier);
  assert.equal(signedAddition.body.addedWalletNullifiers?.length, 1);
  assert.ok(signedAddition.body.nextEscrowBlob);
  assert.notEqual(signedAddition.body.identityNullifier, firstRecord.identityNullifier);

  const addedRecord = await service.submit(signedAddition, { requestNonce: addition.nonce });
  assert.equal((await store.listWallets(addedRecord.identityNullifier)).length, 2);

  // The merged blob the enclave produced must decrypt back to the new set.
  const recheck = new RecheckClient({
    enclaveUrl,
    policy: { allowMock: true },
    fetchImpl: fetch,
  });
  const refreshed = await recheck.recheck({
    escrowBlob: signedAddition.body.nextEscrowBlob!,
    identityNullifier: signedAddition.body.identityNullifier,
    nonce: "recheck-after-addition",
  });
  assert.equal(refreshed.body.identityNullifier, signedAddition.body.identityNullifier);
});

test("mock attestation requires the explicit flag", () => {
  const app = createEnclaveServer({
    env: { NODE_ENV: "test" } as NodeJS.ProcessEnv,
  });
  assert.equal(app.attestation.kind, "confidential-space");
});

test("the saturated enclave gate answers 503 without doing provider work", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const hangingPricing = {
    async quote() {
      await blocked;
      return { priceMicroUsd: 1_000_000n, derived: false };
    },
  };
  const app = createEnclaveServer({
    env: {
      SIXFIGS_MOCK_ATTESTATION: "1",
      SIXFIGS_DEV_INSECURE_BALANCES: "1",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    attestation: new MockAttestationProvider({}),
    pricing: hangingPricing,
    // Ephemeral port: the shared fetch pool must not reuse a stale keep-alive
    // connection from an earlier test server on the same origin.
    port: 0,
  });
  const { port } = await app.listen();
  after(() => app.server.close());

  const client = new RegistrationClient({
    enclaveUrl: `http://127.0.0.1:${port}`,
    policy: { allowMock: true },
    fetchImpl: fetch,
  });

  const accounts = [evmAccount(), evmAccount(), evmAccount(), evmAccount(), evmAccount()];
  const keys = new Map(
    accounts.map((account) => [account.address.toLowerCase(), account.privateKey]),
  );
  const prepared = accounts.map((account) =>
    client.prepare({ wallets: [{ family: "evm", chainId: 1, address: account.address }] }),
  );
  const attempts = prepared.map((entry) =>
    client.submit({ prepared: entry, signatures: signAll(entry, keys) }),
  );
  const outcomes: Array<{ status: "fulfilled" | "rejected"; reason?: unknown }> = [];
  const tracked = attempts.map((attempt) =>
    attempt.then(
      () => {
        outcomes.push({ status: "fulfilled" });
      },
      (reason: unknown) => {
        outcomes.push({ status: "rejected", reason });
      },
    ),
  );
  const start = Date.now();
  while (
    !outcomes.some((outcome) => outcome.status === "rejected") &&
    Date.now() - start < 10_000
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  release();
  await Promise.allSettled(tracked);

  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(outcomes.length, 5);
  assert.equal(rejected.length, 1);
  const reason = rejected[0]!.reason as { code?: string };
  assert.equal(reason.code, "server_busy");
});
test("replayed envelopes are rejected without provider work", async () => {
  const app = createEnclaveServer({
    env: {
      SIXFIGS_MOCK_ATTESTATION: "1",
      SIXFIGS_DEV_INSECURE_BALANCES: "1",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    attestation: new MockAttestationProvider({}),
    pricing: new StaticPricing({}, 3000),
    // Ephemeral port: avoid stale keep-alive connections from prior tests.
    port: 0,
  });
  const { port } = await app.listen();
  after(() => app.server.close());
  const enclaveUrl = `http://127.0.0.1:${port}`;

  let lastEnvelope = "";
  const recordingFetch = (async (url: unknown, init?: { body?: unknown }) => {
    if (typeof url === "string" && url.endsWith("/registration") && init?.body) {
      lastEnvelope = String(init.body);
    }
    return fetch(url as string, init as RequestInit);
  }) as typeof fetch;
  const client = new RegistrationClient({
    enclaveUrl,
    policy: { allowMock: true },
    fetchImpl: recordingFetch,
  });

  const alice = evmAccount();
  const keys = new Map([[alice.address.toLowerCase(), alice.privateKey]]);
  const prepared = client.prepare({
    wallets: [{ family: "evm", chainId: 1, address: alice.address }],
  });
  await client.submit({ prepared, signatures: signAll(prepared, keys) });
  assert.ok(lastEnvelope.length > 0);

  const replay = await fetch(`${enclaveUrl}/registration`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: lastEnvelope,
  });
  assert.equal(replay.status, 400);
  const rejection = (await replay.json()) as { error?: string };
  assert.equal(rejection.error, "replay_detected");
});

test("unexpected enclave failures return a generic message", async () => {
  const throwing = {
    async quote(): Promise<never> {
      throw new Error("secret-connection-string");
    },
  };
  const app = createEnclaveServer({
    env: {
      SIXFIGS_MOCK_ATTESTATION: "1",
      SIXFIGS_DEV_INSECURE_BALANCES: "1",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    attestation: new MockAttestationProvider({}),
    pricing: throwing,
    // Ephemeral port: avoid stale keep-alive connections from prior tests.
    port: 0,
  });
  const { port } = await app.listen();
  after(() => app.server.close());

  const client = new RegistrationClient({
    enclaveUrl: `http://127.0.0.1:${port}`,
    policy: { allowMock: true },
    fetchImpl: fetch,
  });
  const alice = evmAccount();
  const keys = new Map([[alice.address.toLowerCase(), alice.privateKey]]);
  const prepared = client.prepare({
    wallets: [{ family: "evm", chainId: 1, address: alice.address }],
  });
  const failure = await client
    .submit({ prepared, signatures: signAll(prepared, keys) })
    .then(
      () => null,
      (error: unknown) => error as { code?: string; message?: string },
    );
  assert.ok(failure);
  assert.equal(failure?.code, "internal_error");
  assert.equal(failure?.message, "the enclave failed to process the request");
});

test("keyed nullifier mode round trip", async () => {
  const key = bytesToHex(randomBytes(32));
  const app = createEnclaveServer({
    env: {
      SIXFIGS_MOCK_ATTESTATION: "1",
      SIXFIGS_DEV_INSECURE_BALANCES: "1",
      SIXFIGS_NULLIFIER_KEY: key,
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    attestation: new MockAttestationProvider({}),
    pricing: new StaticPricing({}, 3000),
    // Ephemeral port: avoid stale keep-alive connections from prior tests.
    port: 0,
  });
  const { port } = await app.listen();
  after(() => app.server.close());

  const client = new RegistrationClient({
    enclaveUrl: `http://127.0.0.1:${port}`,
    policy: { allowMock: true },
    fetchImpl: fetch,
  });
  const alice = evmAccount();
  const keys = new Map([[alice.address.toLowerCase(), alice.privateKey]]);
  const prepared = client.prepare({
    wallets: [{ family: "evm", chainId: 1, address: alice.address }],
  });
  const signed = await client.submit({ prepared, signatures: signAll(prepared, keys) });

  assert.equal(signed.body.nullifierScheme, "keyed-v1");
  const legacyId = walletSetNullifier(
    walletEntriesFromAddresses([{ family: "evm", address: alice.address, chainId: 1 }]),
  );
  assert.notEqual(signed.body.identityNullifier, legacyId);
});

test("production boot fails closed without a nullifier key", () => {
  assert.throws(
    () => createEnclaveServer({ env: { NODE_ENV: "production" } as NodeJS.ProcessEnv }),
    /SIXFIGS_NULLIFIER_KEY/,
  );
});

test("escrow recheck round trip through HTTP", async () => {
  const app = createEnclaveServer({
    env: {
      SIXFIGS_MOCK_ATTESTATION: "1",
      SIXFIGS_DEV_INSECURE_BALANCES: "1",
      SIXFIGS_ESCROW_KEY: "11".repeat(32),
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    attestation: new MockAttestationProvider({}),
    pricing: new StaticPricing({}, 3000),
    // Ephemeral port: avoid stale keep-alive connections from prior tests.
    port: 0,
  });
  const { port } = await app.listen();
  after(() => app.server.close());
  const enclaveUrl = `http://127.0.0.1:${port}`;

  const client = new RegistrationClient({
    enclaveUrl,
    policy: { allowMock: true },
    fetchImpl: fetch,
  });
  const alice = evmAccount();
  const keys = new Map([[alice.address.toLowerCase(), alice.privateKey]]);
  const prepared = client.prepare({
    wallets: [{ family: "evm", chainId: 1, address: alice.address }],
  });
  const signed = await client.submit({ prepared, signatures: signAll(prepared, keys) });
  assert.ok(signed.body.topAssets.length >= 1);
  assert.ok(signed.body.walletNullifiers[0]!.label === undefined);

  const label = "MetaMask";
  const labeled = client.prepare({
    wallets: [{ family: "evm", chainId: 1, address: alice.address, label }],
  });
  const signedLabeled = await client.submit({
    prepared: labeled,
    signatures: signAll(labeled, keys),
  });
  assert.equal(signedLabeled.body.walletNullifiers[0]!.label, label);

  const hello = await client.hello();
  const escrowBlob = await encryptEscrowBlob(hello.escrowPublicKey, [
    { family: "evm", chainId: 1, address: alice.address, label },
  ]);

  const recheck = new RecheckClient({
    enclaveUrl,
    policy: { allowMock: true },
    fetchImpl: fetch,
  });
  const nonce = "backend-recheck-1234";
  const rechecked = await recheck.recheck({
    escrowBlob,
    identityNullifier: signed.body.identityNullifier,
    nonce,
  });
  assert.equal(rechecked.body.identityNullifier, signed.body.identityNullifier);
  assert.equal(rechecked.body.nonce, nonce);
  assert.deepEqual(rechecked.body.walletNullifiers, signedLabeled.body.walletNullifiers);
  assert.deepEqual(rechecked.body.topAssets, signed.body.topAssets);

  const verifier = new AttestationVerifier({
    audience: "6figs-registration",
    allowMock: true,
    policy: {
      allowedImageDigests: [],
      allowedProjects: [],
      allowedNullifierSchemes: ["legacy-v1"],
    },
  });
  const body = await verifier.verifyRegistration(rechecked, { expectedNonce: nonce });
  assert.equal(body.tier, signed.body.tier);

  const mismatch = await recheck
    .recheck({
      escrowBlob,
      identityNullifier: "0".repeat(64),
      nonce: "backend-recheck-5678",
    })
    .then(
      () => null,
      (error: unknown) => error as { code?: string },
    );
  assert.equal(mismatch?.code, "identity_mismatch");
});

test("recheck is refused without persistent escrow material", async () => {
  const app = createEnclaveServer({
    env: {
      SIXFIGS_MOCK_ATTESTATION: "1",
      SIXFIGS_DEV_INSECURE_BALANCES: "1",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv,
    attestation: new MockAttestationProvider({}),
    pricing: new StaticPricing({}, 3000),
    port: 0,
  });
  const { port } = await app.listen();
  after(() => app.server.close());
  const enclaveUrl = `http://127.0.0.1:${port}`;

  const client = new RegistrationClient({
    enclaveUrl,
    policy: { allowMock: true },
    fetchImpl: fetch,
  });
  const hello = await client.hello();
  const escrowBlob = await encryptEscrowBlob(hello.escrowPublicKey, [
    { family: "evm", chainId: 1, address: evmAccount().address },
  ]);
  const recheck = new RecheckClient({ enclaveUrl, policy: { allowMock: true }, fetchImpl: fetch });
  const failure = await recheck
    .recheck({ escrowBlob, identityNullifier: "0".repeat(64), nonce: "backend-recheck-9999" })
    .then(
      () => null,
      (error: unknown) => error as { code?: string },
    );
  assert.equal(failure?.code, "escrow_unavailable");
});
