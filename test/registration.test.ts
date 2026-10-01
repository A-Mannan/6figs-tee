import { test } from "node:test";
import assert from "node:assert/strict";
import { ed25519 } from "@noble/curves/ed25519";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { ownershipChallenge, walletRemovalChallenge } from "../src/shared/constants.ts";
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
  const keys = new EnclaveKeyManager(attestation, "legacy-v1");
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
  const keys = new EnclaveKeyManager(attestation, "legacy-v1");
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
  const keys = new EnclaveKeyManager(attestation, "keyed-v1");
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

test("enclave hello exposes a verifiable key attestation bound to both keys", async () => {
  const attestation = new MockAttestationProvider({});
  const keys = new EnclaveKeyManager(attestation, "legacy-v1");
  const hello = await keys.hello("test-policy");
  assert.equal(hello.keyId, exportPublicKeys(keys.keys).keyId);
  assert.equal(hello.provider, "mock");
  assert.ok(hello.attestation.attestationToken.split(".").length === 3);
  assert.equal(
    hello.attestation.keyNonce,
    keyAttestationNonce(
      base64urlToBytes(hello.attestation.publicKey),
      base64urlToBytes(hello.encryptionPublicKey),
    ),
  );
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