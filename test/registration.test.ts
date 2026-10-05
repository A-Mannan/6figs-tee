import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  ownershipChallenge,
  walletAdditionChallenge,
  walletRemovalChallenge,
  walletThresholdRemovalChallenge,
} from "../src/shared/constants.ts";
import { encryptEscrowBlob } from "../src/client/escrow.ts";
import { decryptEnvelope } from "../src/shared/envelope.ts";
import { base64urlToBytes, canonicalJson, utf8 } from "../src/shared/crypto.ts";
import {
  exportPublicKeys,
  keyAttestationNonce,
  verifyResultSignature,
} from "../src/shared/attestation.ts";
import {
  LEGACY_NULLIFIER_SCHEME,
  keyedNullifierScheme,
  walletEntriesFromAddresses,
  walletNullifier,
  walletSetNullifier,
} from "../src/shared/nullifiers.ts";
import { randomBytes } from "../src/shared/crypto.ts";
import { base58Encode } from "../src/shared/base58.ts";
import { RegistrationClient } from "../src/client/register.ts";
import { MockAttestationProvider } from "../src/enclave/attestation-provider.ts";
import { EnclaveKeyManager } from "../src/enclave/keys.ts";
import { StaticPricing } from "../src/enclave/pricing.ts";
import { registerPortfolio, RegistrationError } from "../src/enclave/registration.ts";
import type { RegistrationRequest, WalletInput } from "../src/shared/types.ts";

function evmWallet(): { wallet: WalletInput; privateKey: Uint8Array } {
  const privateKey = secp256k1.utils.randomPrivateKey();
  const publicKey = secp256k1.getPublicKey(privateKey, false);
  const address = `0x${Buffer.from(keccak_256(publicKey.slice(1)).slice(-20)).toString("hex")}`;
  return {
    wallet: { family: "evm", chainId: 1, address, signature: "" },
    privateKey,
  };
}

function signEvm(privateKey: Uint8Array, message: string): string {
  const prefix = `\x19Ethereum Signed Message:\n${utf8(message).length}`;
  const digest = keccak_256(concat(utf8(prefix), utf8(message)));
  const signature = secp256k1.sign(digest, privateKey);
  const compact = signature.toCompactRawBytes();
  const recovery = signature.recovery!;
  return Buffer.from(concat(compact, new Uint8Array([recovery + 27]))).toString("hex");
}

function solanaWallet(): { wallet: WalletInput; privateKey: Uint8Array } {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    wallet: { family: "solana", chainId: 0, address: base58Encode(publicKey), signature: "" },
    privateKey,
  };
}

function signSolana(privateKey: Uint8Array, message: string): string {
  return base58Encode(ed25519.sign(utf8(message), privateKey));
}

function identityFor(wallets: WalletInput[]): string {
  return walletSetNullifier(walletEntriesFromAddresses(wallets));
}

function buildRequest(wallets: WalletInput[], overrides: Partial<RegistrationRequest> = {}): RegistrationRequest {
  return {
    nonce: "test-nonce-123",
    timestamp: Date.now(),
    wallets,
    disclosure: "category",
    ...overrides,
  };
}

function deps(prices: Record<string, number> = {}) {
  const attestation = new MockAttestationProvider({});
  const keys = new EnclaveKeyManager(attestation, "legacy-v1", {});
  return {
    keys: keys.keys,
    attestation,
    pricing: new StaticPricing(prices, Number(process.env.TEST_ETH ?? 2500)),
    nullifier: LEGACY_NULLIFIER_SCHEME,
    env: { SIXFIGS_DEV_INSECURE_BALANCES: "1" } as NodeJS.ProcessEnv,
  };
}

test("registerPortfolio verifies EVM ownership and produces a signed result", async () => {
  const { wallet, privateKey } = evmWallet();
  const request = buildRequest([wallet]);
  const nullifier = identityFor(request.wallets);
  wallet.signature = signEvm(
    privateKey,
    ownershipChallenge({
      identityNullifier: nullifier,
      wallets: request.wallets,
      timestamp: request.timestamp,
      nonce: request.nonce,
    }),
  );

  const signed = await registerPortfolio(request, deps());
  const canonical = canonicalJson(signed.body);
  assert.equal(verifyResultSignature(signed.enclavePublicKey, canonical, signed.signature), true);
  assert.ok(Number.isInteger(signed.body.tier));
  assert.equal(signed.body.identityNullifier, nullifier);
  assert.equal(signed.body.walletNullifiers.length, 1);
  assert.equal(signed.body.walletNullifiers[0]!.walletNullifier, walletNullifier("evm", wallet.address));
});

test("registerPortfolio verifies Solana ownership", async () => {
  const { wallet, privateKey } = solanaWallet();
  const request = buildRequest([wallet]);
  const nullifier = identityFor(request.wallets);
  wallet.signature = signSolana(
    privateKey,
    ownershipChallenge({
      identityNullifier: nullifier,
      wallets: request.wallets,
      timestamp: request.timestamp,
      nonce: request.nonce,
    }),
  );
  const signed = await registerPortfolio(request, deps());
  assert.equal(signed.body.walletNullifiers[0]!.family, "solana");
});

test("registerPortfolio rejects a forged EVM signature", async () => {
  const { wallet } = evmWallet();
  const { privateKey: otherKey } = evmWallet();
  const request = buildRequest([wallet]);
  const nullifier = identityFor(request.wallets);
  wallet.signature = signEvm(
    otherKey,
    ownershipChallenge({
      identityNullifier: nullifier,
      wallets: request.wallets,
      timestamp: request.timestamp,
      nonce: request.nonce,
    }),
  );
  await assert.rejects(
    () => registerPortfolio(request, deps()),
    (error: unknown) => error instanceof RegistrationError && error.code === "ownership_failed",
  );
});

test("registerPortfolio rejects stale requests and duplicate wallets", async () => {
  const { wallet } = evmWallet();
  const stale = buildRequest([wallet], { timestamp: Date.now() - 10 * 60_000 });
  await assert.rejects(
    () => registerPortfolio(stale, deps()),
    (error: unknown) => error instanceof RegistrationError && error.code === "stale_request",
  );

  const duplicate = buildRequest([wallet, { ...wallet }]);
  await assert.rejects(
    () => registerPortfolio(duplicate, deps()),
    (error: unknown) => error instanceof RegistrationError && error.code === "duplicate_wallet",
  );
});

test("hidden disclosure omits allocation but keeps stable bps", async () => {
  const { wallet, privateKey } = evmWallet();
  const request = buildRequest([wallet], { disclosure: "hidden" });
  const nullifier = identityFor(request.wallets);
  wallet.signature = signEvm(
    privateKey,
    ownershipChallenge({
      identityNullifier: nullifier,
      wallets: request.wallets,
      timestamp: request.timestamp,
      nonce: request.nonce,
    }),
  );
  const signed = await registerPortfolio(request, deps());
  assert.deepEqual(signed.body.allocation, []);
  assert.equal(signed.body.disclosure, "hidden");
});

test("registerPortfolio accepts a removal with consents and reports the detached set", async () => {
  const alice = evmWallet();
  const bob = evmWallet();
  const kept = [alice.wallet];
  const request = buildRequest(kept, { removals: [bob.wallet] });
  const nextIdentity = identityFor(kept);

  alice.wallet.signature = signEvm(
    alice.privateKey,
    ownershipChallenge({
      identityNullifier: nextIdentity,
      wallets: kept,
      timestamp: request.timestamp,
      nonce: request.nonce,
    }),
  );
  bob.wallet.signature = signEvm(
    bob.privateKey,
    walletRemovalChallenge({
      family: "evm",
      address: bob.wallet.address,
      nextIdentityNullifier: nextIdentity,
      timestamp: request.timestamp,
      nonce: request.nonce,
    }),
  );

  const signed = await registerPortfolio(request, deps());
  assert.equal(signed.body.identityNullifier, nextIdentity);
  assert.equal(signed.body.nullifierScheme, "legacy-v1");
  assert.equal(signed.body.removedWalletNullifiers?.length, 1);
  assert.equal(
    signed.body.removedWalletNullifiers?.[0]?.walletNullifier,
    walletNullifier("evm", bob.wallet.address),
  );
  assert.equal(signed.body.walletNullifiers.length, 1);
});

test("registerPortfolio rejects a removal without a removal consent", async () => {
  const alice = evmWallet();
  const bob = evmWallet();
  const kept = [alice.wallet];
  const request = buildRequest(kept, { removals: [bob.wallet] });
  const nextIdentity = identityFor(kept);

  alice.wallet.signature = signEvm(
    alice.privateKey,
    ownershipChallenge({
      identityNullifier: nextIdentity,
      wallets: kept,
      timestamp: request.timestamp,
      nonce: request.nonce,
    }),
  );
  bob.wallet.signature = signEvm(
    bob.privateKey,
    ownershipChallenge({
      identityNullifier: nextIdentity,
      wallets: kept,
      timestamp: request.timestamp,
      nonce: request.nonce,
    }),
  );

  await assert.rejects(
    () => registerPortfolio(request, deps()),
    (error: unknown) => error instanceof RegistrationError && error.code === "removal_failed",
  );
});

test("ownership challenge lists the authorized wallet set", () => {
  const message = ownershipChallenge({
    identityNullifier: "ab".repeat(32),
    wallets: [
      { family: "evm", address: "0xABCDEF0000000000000000000000000000000001" },
      { family: "solana", address: "So1anaAddr" },
    ],
    timestamp: 1_700_000_000_000,
    nonce: "n",
  });
  assert.ok(message.includes("evm:0xabcdef0000000000000000000000000000000001"));
  assert.ok(message.includes("solana:So1anaAddr"));
});

test("registerPortfolio aborts when the registration budget is exceeded", async () => {
  const alice = evmWallet();
  const bob = evmWallet();
  const request = buildRequest([alice.wallet, bob.wallet]);
  const nullifier = identityFor(request.wallets);
  for (const { wallet, privateKey } of [alice, bob]) {
    wallet.signature = signEvm(
      privateKey,
      ownershipChallenge({
        identityNullifier: nullifier,
        wallets: request.wallets,
        timestamp: request.timestamp,
        nonce: request.nonce,
      }),
    );
  }

  const slowPricing = {
    async quote() {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { priceMicroUsd: 1_000_000n, derived: false };
    },
  };
  const attestation = new MockAttestationProvider({});
  const keys = new EnclaveKeyManager(attestation, "legacy-v1", {});
  await assert.rejects(
    () =>
      registerPortfolio(request, {
        keys: keys.keys,
        attestation,
        pricing: slowPricing,
        nullifier: LEGACY_NULLIFIER_SCHEME,
        env: {
          SIXFIGS_DEV_INSECURE_BALANCES: "1",
          SIXFIGS_REGISTRATION_BUDGET_MS: "1",
        } as NodeJS.ProcessEnv,
      }),
    (error: unknown) =>
      error instanceof RegistrationError && error.code === "budget_exceeded",
  );
});

test("registerPortfolio derives unguessable nullifiers under the keyed scheme", async () => {
  const { wallet, privateKey } = evmWallet();
  const request = buildRequest([wallet]);
  const challengeId = identityFor(request.wallets);
  wallet.signature = signEvm(
    privateKey,
    ownershipChallenge({
      identityNullifier: challengeId,
      wallets: request.wallets,
      timestamp: request.timestamp,
      nonce: request.nonce,
    }),
  );

  const scheme = keyedNullifierScheme(randomBytes(32));
  const attestation = new MockAttestationProvider({});
  const keys = new EnclaveKeyManager(attestation, "keyed-v1", {});
  const run = () =>
    registerPortfolio(request, {
      keys: keys.keys,
      attestation,
      pricing: new StaticPricing({}, Number(process.env.TEST_ETH ?? 2500)),
      nullifier: scheme,
      env: { SIXFIGS_DEV_INSECURE_BALANCES: "1" } as NodeJS.ProcessEnv,
    });

  const first = await run();
  assert.equal(first.body.nullifierScheme, "keyed-v1");
  assert.notEqual(
    first.body.walletNullifiers[0]!.walletNullifier,
    walletNullifier("evm", wallet.address),
  );
  assert.notEqual(first.body.identityNullifier, challengeId);

  const second = await run();
  assert.equal(second.body.identityNullifier, first.body.identityNullifier);

  const other = keyedNullifierScheme(randomBytes(32));
  assert.notEqual(
    other.walletNullifier("evm", wallet.address),
    first.body.walletNullifiers[0]!.walletNullifier,
  );
});

test("wallet and identity nullifiers are deterministic and set-scoped", () => {
  assert.equal(walletNullifier("evm", "0xABC"), walletNullifier("evm", "0xabc"));
  assert.equal(walletNullifier("evm", "0xabc").length, 64);
  assert.notEqual(walletNullifier("evm", "0xabc"), walletNullifier("solana", "0xabc"));

  const a = { family: "evm" as const, address: "0xabc", chainId: 1 };
  const b = { family: "solana" as const, address: "So1ana", chainId: 0 };
  const ab = walletSetNullifier(walletEntriesFromAddresses([a, b]));
  const ba = walletSetNullifier(walletEntriesFromAddresses([b, a]));
  assert.equal(ab, ba, "wallet set commitment is order-independent");
  assert.notEqual(ab, walletSetNullifier(walletEntriesFromAddresses([a])));
  assert.notEqual(identityFor([{ family: "evm", chainId: 1, address: a.address, signature: "" }]), ab);
});

test("enclave hello exposes a verifiable key attestation bound to all keys", async () => {
  const attestation = new MockAttestationProvider({});
  const keys = new EnclaveKeyManager(attestation, "legacy-v1", {});
  const hello = await keys.hello("test-policy");
  assert.equal(hello.keyId, exportPublicKeys(keys.keys).keyId);
  assert.equal(hello.provider, "mock");
  assert.equal(hello.escrowKeyProvider, "none");
  assert.ok(hello.attestation.attestationToken.split(".").length === 3);
  assert.equal(
    hello.attestation.keyNonce,
    keyAttestationNonce(
      base64urlToBytes(hello.attestation.publicKey),
      base64urlToBytes(hello.encryptionPublicKey),
      base64urlToBytes(hello.escrowPublicKey),
    ),
  );
});

test("enclave hello re-mints an expired key attestation instead of serving it stale", async () => {
  const attestation = new MockAttestationProvider({});
  const keys = new EnclaveKeyManager(attestation, "legacy-v1", {});
  const realNow = Date.now;
  try {
    const first = await keys.hello("test-policy");
    // Same cached response inside the TTL window.
    const cached = await keys.hello("test-policy");
    assert.equal(cached.attestation.attestationToken, first.attestation.attestationToken);
    // Past the TTL, the launcher must be asked again for a fresh token.
    Date.now = () => realNow() + 31 * 60_000;
    const refreshed = await keys.hello("test-policy");
    assert.notEqual(refreshed.attestation.attestationToken, first.attestation.attestationToken);
  } finally {
    Date.now = realNow;
  }
});

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

test("prepare() adopts a caller nonce and it round-trips into body.nonce", async () => {
  const { wallet, privateKey } = evmWallet();
  const client = new RegistrationClient({ enclaveUrl: "http://127.0.0.1:1" });
  const callerNonce = "backend-session-9f2c41aa77";
  const prepared = client.prepare({
    wallets: [{ family: "evm", chainId: 1, address: wallet.address }],
    nonce: callerNonce,
  });
  assert.equal(prepared.nonce, callerNonce);

  wallet.signature = signEvm(privateKey, prepared.message);
  const request = buildRequest([wallet], {
    nonce: prepared.nonce,
    timestamp: prepared.timestamp,
  });
  const signed = await registerPortfolio(request, deps());
  assert.equal(signed.body.nonce, callerNonce);
});
test("registerPortfolio merges an addition from the escrow blob and signs the transition", async () => {
  const escrowHex = Buffer.from(randomBytes(32)).toString("hex");
  const attestation = new MockAttestationProvider({});
  const manager = new EnclaveKeyManager(attestation, "keyed-v1", {
    SIXFIGS_ESCROW_KEY: escrowHex,
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);
  await manager.ensureEscrowLoaded();
  const scheme = keyedNullifierScheme(randomBytes(32));

  const { wallet: existing } = solanaWallet();
  const { wallet: added, privateKey: addedKey } = solanaWallet();
  const escrowBlob = await encryptEscrowBlob(exportPublicKeys(manager.keys).escrowPublicKey, [
    { family: existing.family, chainId: existing.chainId, address: existing.address },
  ]);
  const baseIdentity = walletSetNullifier(
    walletEntriesFromAddresses([existing], scheme),
  );
  const timestamp = Date.now();
  added.signature = signSolana(
    addedKey,
    walletAdditionChallenge({
      family: added.family,
      address: added.address,
      accountIdentityNullifier: baseIdentity,
      timestamp,
      nonce: "addition-nonce-123",
    }),
  );

  const signed = await registerPortfolio(
    {
      nonce: "addition-nonce-123",
      timestamp,
      mode: "add",
      escrowBlob,
      baseIdentityNullifier: baseIdentity,
      wallets: [added],
      disclosure: "hidden",
    },
    {
      keys: manager.keys,
      attestation,
      pricing: new StaticPricing({}, 2500),
      nullifier: scheme,
      escrowPersistent: true,
      env: { SIXFIGS_DEV_INSECURE_BALANCES: "1" } as NodeJS.ProcessEnv,
    },
  );

  assert.equal(signed.body.previousIdentityNullifier, baseIdentity);
  assert.equal(signed.body.addedWalletNullifiers?.length, 1);
  assert.equal(signed.body.walletNullifiers.length, 2);
  assert.notEqual(signed.body.identityNullifier, baseIdentity);
  assert.equal(signed.body.identityNullifier.length, 64);

  const reopened = await decryptEnvelope<{ v: 1; wallets: Array<{ address: string }> }>(
    manager.keys.escrowPrivate,
    signed.body.nextEscrowBlob!,
  );
  assert.deepEqual(
    reopened.wallets.map((wallet) => wallet.address).sort(),
    [existing.address, added.address].sort(),
  );
});

test("registerPortfolio refuses additions without persistent escrow material", async () => {
  const { wallet: added } = solanaWallet();
  added.signature = base58Encode(randomBytes(64));
  await assert.rejects(
    () =>
      registerPortfolio(
        {
          nonce: "addition-nonce-123",
          timestamp: Date.now(),
          mode: "add",
          escrowBlob: { v: 1, epk: "e", iv: "i", ct: "c" },
          baseIdentityNullifier: "ab".repeat(32),
          wallets: [added],
          disclosure: "hidden",
        },
        { ...deps(), escrowPersistent: false },
      ),
    (error: unknown) =>
      error instanceof RegistrationError && error.code === "escrow_unavailable",
  );
});

test("registerPortfolio refuses an addition whose blob belongs to another account", async () => {
  const escrowHex = Buffer.from(randomBytes(32)).toString("hex");
  const attestation = new MockAttestationProvider({});
  const manager = new EnclaveKeyManager(attestation, "legacy-v1", {
    SIXFIGS_ESCROW_KEY: escrowHex,
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);
  await manager.ensureEscrowLoaded();

  const { wallet: existing } = solanaWallet();
  const { wallet: added, privateKey: addedKey } = solanaWallet();
  const escrowBlob = await encryptEscrowBlob(exportPublicKeys(manager.keys).escrowPublicKey, [
    { family: existing.family, chainId: existing.chainId, address: existing.address },
  ]);
  const wrongBase = "ab".repeat(32);
  added.signature = signSolana(
    addedKey,
    walletAdditionChallenge({
      family: added.family,
      address: added.address,
      accountIdentityNullifier: wrongBase,
      timestamp: Date.now(),
      nonce: "addition-nonce-123",
    }),
  );

  await assert.rejects(
    () =>
      registerPortfolio(
        {
          nonce: "addition-nonce-123",
          timestamp: Date.now(),
          mode: "add",
          escrowBlob,
          baseIdentityNullifier: wrongBase,
          wallets: [added],
          disclosure: "hidden",
        },
        {
          keys: manager.keys,
          attestation,
          pricing: new StaticPricing({}, 2500),
          nullifier: LEGACY_NULLIFIER_SCHEME,
          escrowPersistent: true,
          env: { SIXFIGS_DEV_INSECURE_BALANCES: "1" } as NodeJS.ProcessEnv,
        },
      ),
    (error: unknown) =>
      error instanceof RegistrationError && error.code === "base_identity_mismatch",
  );
});

test("prepareAddition keeps the consent compact and the identity fixed-length", () => {
  const client = new RegistrationClient({ enclaveUrl: "http://127.0.0.1:1" });
  const account = "cd".repeat(32);
  const wallet = {
    family: "solana" as const,
    chainId: 0,
    address: base58Encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey())),
  };
  const prepared = client.prepareAddition({
    added: [wallet],
    escrowBlob: { v: 1, epk: "e", iv: "i", ct: "c" },
    accountIdentityNullifier: account,
    nonce: "addition-nonce-123",
  });
  const message = prepared.addMessages[`solana:${wallet.address.toLowerCase()}`]!;
  assert.ok(message.includes(account));
  assert.ok(message.includes(wallet.address));
  assert.ok(message.includes("addition-nonce-123"));
  // The message names one wallet regardless of how large the stored set is.
  assert.ok(message.length < 400, `message too long: ${message.length}`);

  const one = walletSetNullifier(walletEntriesFromAddresses([wallet]));
  const twenty = walletSetNullifier(
    walletEntriesFromAddresses(
      Array.from({ length: 20 }, () => ({
        family: "solana" as const,
        address: base58Encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey())),
      })),
    ),
  );
  assert.equal(one.length, 64);
  assert.equal(twenty.length, 64);
});

function escrowManager(escrowHex: string, scheme: "legacy-v1" | "keyed-v1") {
  const attestation = new MockAttestationProvider({});
  const manager = new EnclaveKeyManager(attestation, scheme, {
    SIXFIGS_ESCROW_KEY: escrowHex,
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv);
  return { attestation, manager };
}

test("registerPortfolio prunes a wallet when every kept wallet signs", async () => {
  const { attestation, manager } = escrowManager(
    Buffer.from(randomBytes(32)).toString("hex"),
    "legacy-v1",
  );
  await manager.ensureEscrowLoaded();

  const { wallet: keptWallet, privateKey: keptKey } = evmWallet();
  const lostWallet = solanaWallet().wallet;
  const escrowBlob = await encryptEscrowBlob(exportPublicKeys(manager.keys).escrowPublicKey, [
    { family: keptWallet.family, chainId: keptWallet.chainId, address: keptWallet.address },
    { family: lostWallet.family, chainId: lostWallet.chainId, address: lostWallet.address },
  ]);
  const baseIdentity = walletSetNullifier(
    walletEntriesFromAddresses([keptWallet, lostWallet], LEGACY_NULLIFIER_SCHEME),
  );
  const timestamp = Date.now();
  const nonce = "removal-nonce-123";
  const message = walletThresholdRemovalChallenge({
    accountIdentityNullifier: baseIdentity,
    removals: [lostWallet],
    timestamp,
    nonce,
  });

  const suppliedKept = { ...keptWallet, signature: signEvm(keptKey, message) };
  const lostFromBlob = walletEntriesFromAddresses(
    [lostWallet],
    LEGACY_NULLIFIER_SCHEME,
  ).map((entry) => entry.walletNullifier);

  const signed = await registerPortfolio(
    {
      nonce,
      timestamp,
      mode: "remove",
      escrowBlob,
      baseIdentityNullifier: baseIdentity,
      wallets: [suppliedKept],
      removals: [{ ...lostWallet, signature: "" }],
      disclosure: "hidden",
    },
    {
      keys: manager.keys,
      attestation,
      pricing: new StaticPricing({}, 2500),
      nullifier: LEGACY_NULLIFIER_SCHEME,
      escrowPersistent: true,
      env: { SIXFIGS_DEV_INSECURE_BALANCES: "1" } as NodeJS.ProcessEnv,
    },
  );

  assert.equal(signed.body.previousIdentityNullifier, baseIdentity);
  assert.equal(signed.body.walletNullifiers.length, 1);
  assert.deepEqual(
    signed.body.removedWalletNullifiers?.map((entry) => entry.walletNullifier),
    lostFromBlob,
  );
  assert.notEqual(signed.body.identityNullifier, baseIdentity);

  const reopened = await decryptEnvelope<{ v: 1; wallets: Array<{ address: string }> }>(
    manager.keys.escrowPrivate,
    signed.body.nextEscrowBlob!,
  );
  assert.deepEqual(
    reopened.wallets.map((wallet) => wallet.address),
    [keptWallet.address],
  );
});

test("registerPortfolio refuses a removal missing a kept wallet signature", async () => {
  const { attestation, manager } = escrowManager(
    Buffer.from(randomBytes(32)).toString("hex"),
    "legacy-v1",
  );
  await manager.ensureEscrowLoaded();

  const keptWallet = evmWallet().wallet;
  const lostWallet = solanaWallet().wallet;
  const escrowBlob = await encryptEscrowBlob(exportPublicKeys(manager.keys).escrowPublicKey, [
    { family: keptWallet.family, chainId: keptWallet.chainId, address: keptWallet.address },
    { family: lostWallet.family, chainId: lostWallet.chainId, address: lostWallet.address },
  ]);
  const baseIdentity = walletSetNullifier(
    walletEntriesFromAddresses([keptWallet, lostWallet], LEGACY_NULLIFIER_SCHEME),
  );

  await assert.rejects(
    () =>
      registerPortfolio(
        {
          nonce: "removal-nonce-123",
          timestamp: Date.now(),
          mode: "remove",
          escrowBlob,
          baseIdentityNullifier: baseIdentity,
          wallets: [{ ...keptWallet, signature: "00" }],
          removals: [{ ...lostWallet, signature: "" }],
          disclosure: "hidden",
        },
        {
          keys: manager.keys,
          attestation,
          pricing: new StaticPricing({}, 2500),
          nullifier: LEGACY_NULLIFIER_SCHEME,
          escrowPersistent: true,
          env: { SIXFIGS_DEV_INSECURE_BALANCES: "1" } as NodeJS.ProcessEnv,
        },
      ),
    (error: unknown) =>
      error instanceof RegistrationError && error.code === "ownership_failed",
  );
});

test("registerPortfolio refuses removing an unknown wallet or every wallet", async () => {
  const { attestation, manager } = escrowManager(
    Buffer.from(randomBytes(32)).toString("hex"),
    "legacy-v1",
  );
  await manager.ensureEscrowLoaded();

  const only = evmWallet().wallet;
  const { wallet: unknown } = solanaWallet();
  const escrowBlob = await encryptEscrowBlob(exportPublicKeys(manager.keys).escrowPublicKey, [
    { family: only.family, chainId: only.chainId, address: only.address },
  ]);
  const baseIdentity = walletSetNullifier(
    walletEntriesFromAddresses([only], LEGACY_NULLIFIER_SCHEME),
  );
  const depsForRemoval = {
    keys: manager.keys,
    attestation,
    pricing: new StaticPricing({}, 2500),
    nullifier: LEGACY_NULLIFIER_SCHEME,
    escrowPersistent: true,
    env: { SIXFIGS_DEV_INSECURE_BALANCES: "1" } as NodeJS.ProcessEnv,
  };

  await assert.rejects(
    () =>
      registerPortfolio(
        {
          nonce: "removal-nonce-123",
          timestamp: Date.now(),
          mode: "remove",
          escrowBlob,
          baseIdentityNullifier: baseIdentity,
          wallets: [{ ...only, signature: "00" }],
          removals: [{ ...unknown, signature: "" }],
          disclosure: "hidden",
        },
        depsForRemoval,
      ),
    (error: unknown) =>
      error instanceof RegistrationError && error.code === "unknown_wallet",
  );

  await assert.rejects(
    () =>
      registerPortfolio(
        {
          nonce: "removal-nonce-123",
          timestamp: Date.now(),
          mode: "remove",
          escrowBlob,
          baseIdentityNullifier: baseIdentity,
          wallets: [{ ...only, signature: "00" }],
          removals: [{ ...only, signature: "" }],
          disclosure: "hidden",
        },
        depsForRemoval,
      ),
    (error: unknown) =>
      error instanceof RegistrationError && error.code === "bad_request",
  );
});

test("registerPortfolio refuses removals without persistent escrow material", async () => {
  const { wallet: lost } = solanaWallet();
  await assert.rejects(
    () =>
      registerPortfolio(
        {
          nonce: "removal-nonce-123",
          timestamp: Date.now(),
          mode: "remove",
          escrowBlob: { v: 1, epk: "e", iv: "i", ct: "c" },
          baseIdentityNullifier: "ab".repeat(32),
          wallets: [lost],
          removals: [{ ...lost, signature: "" }],
          disclosure: "hidden",
        },
        { ...deps(), escrowPersistent: false },
      ),
    (error: unknown) =>
      error instanceof RegistrationError && error.code === "escrow_unavailable",
  );
});

test("prepareRemoval names the removed wallets and the account", () => {
  const client = new RegistrationClient({ enclaveUrl: "http://127.0.0.1:1" });
  const account = "ef".repeat(32);
  const kept = {
    family: "solana" as const,
    chainId: 0,
    address: base58Encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey())),
  };
  const lost = {
    family: "solana" as const,
    chainId: 0,
    address: base58Encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey())),
  };
  const prepared = client.prepareRemoval({
    kept: [kept],
    remove: [lost],
    escrowBlob: { v: 1, epk: "e", iv: "i", ct: "c" },
    accountIdentityNullifier: account,
    nonce: "removal-nonce-123",
  });
  assert.ok(prepared.message.includes(account));
  assert.ok(prepared.message.includes(lost.address));
  assert.ok(prepared.message.includes("removal-nonce-123"));
  assert.ok(prepared.message.length < 500);
});
