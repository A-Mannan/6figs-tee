import {
  activeTiers,
  DOMAIN,
  MAX_ASSETS_PER_REQUEST,
  POLICY_VERSION,
  walletAdditionChallenge,
  walletRemovalChallenge,
} from "../shared/constants.ts";
import { decryptEnvelope, encryptEnvelope } from "../shared/envelope.ts";
import {
  canonicalJson,
  sha256Bytes,
  sha256Hex,
  utf8,
} from "../shared/crypto.ts";
import {
  LEGACY_NULLIFIER_SCHEME,
  walletEntriesFromAddresses,
  walletSetNullifier,
  type NullifierScheme,
} from "../shared/nullifiers.ts";
import {
  assignTier,
  computeAllocation,
  nextTierFloor,
  portfolioBand,
  sanitizeWalletLabel,
  topAssetSymbols,
  valueMicroUsd,
  type CategorizedPosition,
  type ValuedHolding,
} from "../shared/tier.ts";
import type {
  EscrowPayload,
  RecheckPayload,
  RegistrationRequest,
  RegistrationResultBody,
  SignedRegistration,
  WalletInput,
  WalletNullifierEntry,
} from "../shared/types.ts";
import type { EnclaveKeys } from "../shared/attestation.ts";
import {
  bindingNonce,
  exportPublicKeys,
  signResult,
} from "../shared/attestation.ts";
import type { AttestationProvider } from "./attestation-provider.ts";
import { verifyOwnership, verifyWalletSignature } from "./ownership.ts";
import {
  discoverEvmBalances,
  evmRpcsFromEnv,
  httpsUrl,
  type RawBalance,
} from "./balances.ts";
import { RpcDisagreementError } from "./rpc.ts";
import { discoverSolanaBalances } from "./solana.ts";
import { categoryForPrice, type PricingProvider } from "./pricing.ts";

const REQUEST_MAX_AGE_MS = 120_000;
const MAX_WALLETS = 20;
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REGISTRATION_BUDGET_MS = 30_000;

export interface RegistrationDeps {
  keys: EnclaveKeys;
  attestation: AttestationProvider;
  pricing: PricingProvider;
  /** Nullifier scheme for the emitted nullifiers; the challenge always binds
   * the legacy set commitment so clients need no secret to sign. */
  nullifier: NullifierScheme;
  env?: NodeJS.ProcessEnv;
  /** Rechecks require persistent escrow material; absent means refuse. */
  escrowPersistent?: boolean;
}

export class RegistrationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function registerPortfolio(
  request: RegistrationRequest,
  deps: RegistrationDeps,
): Promise<SignedRegistration> {
  const env = deps.env ?? process.env;
  validateRequestShape(request);

  if (request.mode === "add") {
    return registerAddition(request, deps);
  }

  const now = Date.now();
  if (Math.abs(now - request.timestamp) > REQUEST_MAX_AGE_MS) {
    throw new RegistrationError("stale_request", "request timestamp is outside the freshness window");
  }
  const deadline = now + (Number(env.SIXFIGS_REGISTRATION_BUDGET_MS) || DEFAULT_REGISTRATION_BUDGET_MS);

  const removals = request.removals ?? [];
  const labeledWallets = withLabels(request.wallets);
  const walletNullifiers = walletEntriesFromAddresses(labeledWallets, deps.nullifier);
  const removedNullifiers = walletEntriesFromAddresses(removals, deps.nullifier);

  const seen = new Set<string>();
  for (const entry of [...walletNullifiers, ...removedNullifiers]) {
    if (seen.has(entry.walletNullifier)) {
      throw new RegistrationError("duplicate_wallet", "the same wallet was submitted twice");
    }
    seen.add(entry.walletNullifier);
  }

  // The account is the wallet set. No client-held secret exists: recovery is
  // simply presenting the same wallets again.
  const idNullifier = walletSetNullifier(walletNullifiers);

  // Challenges bind the legacy set commitment, which the client derives
  // without the enclave's nullifier key. Stored nullifiers use the active
  // scheme; the backend checks that commitment independently.
  const challengeId = walletSetNullifier(
    walletEntriesFromAddresses(request.wallets, LEGACY_NULLIFIER_SCHEME),
  );

  // 1. Ownership: every enrolled address signs the new set (whose membership
  // is listed in the message), and every removed address signs a removal
  // consent bound to that set plus this request nonce.
  for (const wallet of request.wallets) {
    const result = verifyOwnership(wallet, {
      identityNullifier: challengeId,
      wallets: request.wallets,
      timestamp: request.timestamp,
      nonce: request.nonce,
    });
    if (!result.ok) {
      throw new RegistrationError(
        "ownership_failed",
        `wallet ownership check failed: ${result.reason}`,
      );
    }
  }

  for (const wallet of removals) {
    const message = walletRemovalChallenge({
      family: wallet.family,
      address: wallet.address,
      nextIdentityNullifier: challengeId,
      timestamp: request.timestamp,
      nonce: request.nonce,
    });
    const result = verifyWalletSignature(wallet, message);
    if (!result.ok) {
      throw new RegistrationError(
        "removal_failed",
        `wallet removal check failed: ${result.reason}`,
      );
    }
  }

  // 2. Balances: discover across all configured chains for each address.
  // The asset budget bounds provider work; the deadline drops the request
  // instead of silently pricing a subset. Provider disagreement fails the
  // request rather than trusting either side.
  let rawBalances: RawBalance[];
  try {
    rawBalances = await collectBalances(request.wallets, env, deadline, MAX_ASSETS_PER_REQUEST);
  } catch (error) {
    if (error instanceof RpcDisagreementError) {
      throw new RegistrationError("rpc_disagreement", "redundant RPC providers disagree");
    }
    throw error;
  }

  // 3. Prices + valuation. Unpriceable assets are skipped, per product spec.
  const valued = await valueBalances(rawBalances, deps.pricing, deadline);

  // 4. Tier, allocation, nullifiers.
  const tiers = tiersForEnv(env);
  const tier = assignTier(valued.totalMicroUsd, tiers);

  const body: RegistrationResultBody = {
    v: 1,
    policyVersion: POLICY_VERSION,
    tier: tier.id,
    tierLabel: tier.label,
    tierFloorMicroUsd: tier.minMicroUsd.toString(),
    nextTierFloorMicroUsd: nextTierFloor(tier.id, tiers).toString(),
    portfolioBand: portfolioBand(valued.totalMicroUsd, tiers),
    stableBps: valued.stableBps,
    topAssets: valued.topAssets,
    disclosure: request.disclosure,
    allocation: request.disclosure === "hidden" ? [] : valued.allocation,
    walletNullifiers,
    identityNullifier: idNullifier,
    createdAt: now,
    expiresAt: now + RESULT_TTL_MS,
    nonce: request.nonce,
    nullifierScheme: deps.nullifier.name,
    ...(removedNullifiers.length > 0 ? { removedWalletNullifiers: removedNullifiers } : {}),
  };

  return signBody(body, deps);
}

/**
 * Extend an account by merging added wallets into the set carried by the
 * stored escrow blob. Only the added wallets sign; the account's authority
 * comes from the email session on the backend, which checks the transition
 * against its stored bindings before persisting anything. The old set never
 * round-trips in plaintext: the enclave decrypts it, recomputes its identity,
 * and refuses a blob that does not match the claimed base identity.
 */
async function registerAddition(
  request: RegistrationRequest,
  deps: RegistrationDeps,
): Promise<SignedRegistration> {
  const env = deps.env ?? process.env;
  if (!deps.escrowPersistent) {
    throw new RegistrationError(
      "escrow_unavailable",
      "escrow key is not persistent; additions are disabled",
    );
  }
  if (!request.escrowBlob || typeof request.baseIdentityNullifier !== "string") {
    throw new RegistrationError(
      "bad_request",
      "add mode requires escrowBlob and baseIdentityNullifier",
    );
  }
  if ((request.removals ?? []).length > 0) {
    throw new RegistrationError("bad_request", "removals are not accepted in add mode");
  }

  const now = Date.now();
  if (Math.abs(now - request.timestamp) > REQUEST_MAX_AGE_MS) {
    throw new RegistrationError("stale_request", "request timestamp is outside the freshness window");
  }
  const deadline = now + (Number(env.SIXFIGS_REGISTRATION_BUDGET_MS) || DEFAULT_REGISTRATION_BUDGET_MS);

  const escrow = await decryptEnvelope<EscrowPayload>(
    deps.keys.escrowPrivate,
    request.escrowBlob,
  ).catch(() => {
    throw new RegistrationError("bad_escrow", "escrow blob could not be decrypted");
  });
  if (!escrow || escrow.v !== 1 || !Array.isArray(escrow.wallets) || escrow.wallets.length === 0) {
    throw new RegistrationError("bad_escrow", "escrow payload is malformed");
  }

  const existing = withLabels(escrow.wallets);
  const existingEntries = walletEntriesFromAddresses(existing, deps.nullifier);
  const baseIdentity = walletSetNullifier(existingEntries);
  if (baseIdentity !== request.baseIdentityNullifier) {
    throw new RegistrationError(
      "base_identity_mismatch",
      "escrow blob belongs to a different account than claimed",
    );
  }

  const existingKeys = new Set(existing.map((wallet) => walletKey(wallet)));
  const added = withLabels(request.wallets);

  // Only the added wallets prove control, and only over the exact account,
  // wallet, nonce, and timestamp in the compact challenge.
  for (const wallet of added) {
    if (existingKeys.has(walletKey(wallet))) {
      throw new RegistrationError("already_enrolled", "wallet is already in the account");
    }
    const message = walletAdditionChallenge({
      family: wallet.family,
      address: wallet.address,
      accountIdentityNullifier: baseIdentity,
      timestamp: request.timestamp,
      nonce: request.nonce,
    });
    const result = verifyWalletSignature(wallet, message);
    if (!result.ok) {
      throw new RegistrationError(
        "ownership_failed",
        `wallet addition check failed: ${result.reason}`,
      );
    }
  }

  // Keyed nullifiers are deterministic per address, so duplicate addresses
  // within or across the added set would collapse the commitment silently.
  const merged = [...existing, ...added];
  if (merged.length > MAX_WALLETS) {
    throw new RegistrationError("bad_request", `at most ${MAX_WALLETS} wallets are allowed`);
  }
  const mergedEntries = walletEntriesFromAddresses(merged, deps.nullifier);
  const addedEntries = walletEntriesFromAddresses(added, deps.nullifier);
  assertDistinctNullifiers(mergedEntries);

  let rawBalances: RawBalance[];
  try {
    rawBalances = await collectBalances(merged, env, deadline, MAX_ASSETS_PER_REQUEST);
  } catch (error) {
    if (error instanceof RpcDisagreementError) {
      throw new RegistrationError("rpc_disagreement", "redundant RPC providers disagree");
    }
    throw error;
  }

  const valued = await valueBalances(rawBalances, deps.pricing, deadline);
  const tiers = tiersForEnv(env);
  const tier = assignTier(valued.totalMicroUsd, tiers);

  // The merged set must survive restarts for the next recheck or addition,
  // so the enclave re-encrypts it to its own escrow key and signs the blob
  // into the result for the backend to store.
  const nextEscrowBlob = await encryptEnvelope<EscrowPayload>(deps.keys.escrowPublic, {
    v: 1,
    wallets: merged.map((wallet) => ({
      family: wallet.family,
      chainId: wallet.chainId,
      address: wallet.address,
      ...(wallet.label ? { label: wallet.label } : {}),
    })),
  });

  const identity = walletSetNullifier(mergedEntries);
  const body: RegistrationResultBody = {
    v: 1,
    policyVersion: POLICY_VERSION,
    tier: tier.id,
    tierLabel: tier.label,
    tierFloorMicroUsd: tier.minMicroUsd.toString(),
    nextTierFloorMicroUsd: nextTierFloor(tier.id, tiers).toString(),
    portfolioBand: portfolioBand(valued.totalMicroUsd, tiers),
    stableBps: valued.stableBps,
    topAssets: valued.topAssets,
    disclosure: request.disclosure,
    allocation: request.disclosure === "hidden" ? [] : valued.allocation,
    walletNullifiers: mergedEntries,
    previousIdentityNullifier: baseIdentity,
    addedWalletNullifiers: addedEntries,
    nextEscrowBlob,
    identityNullifier: identity,
    createdAt: now,
    expiresAt: now + RESULT_TTL_MS,
    nonce: request.nonce,
    nullifierScheme: deps.nullifier.name,
  };

  return signBody(body, deps);
}

function walletKey(wallet: { family: "evm" | "solana"; address: string }): string {
  return `${wallet.family}:${wallet.family === "evm" ? wallet.address.toLowerCase() : wallet.address}`;
}

function assertDistinctNullifiers(entries: readonly WalletNullifierEntry[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.walletNullifier)) {
      throw new RegistrationError("duplicate_wallet", "the same wallet was submitted twice");
    }
    seen.add(entry.walletNullifier);
  }
}

/**
 * Recheck a stored escrow blob: decrypt with the enclave escrow key, refuse a
 * blob whose recomputed identity differs from the claimed one, re-fetch
 * balances and prices, and return a fresh signed, attested result. Possession
 * of the blob is the capability; no wallet signatures are required.
 */
export async function recheckPortfolio(
  payload: RecheckPayload,
  deps: RegistrationDeps,
): Promise<SignedRegistration> {
  const env = deps.env ?? process.env;
  if (!deps.escrowPersistent) {
    throw new RegistrationError(
      "escrow_unavailable",
      "escrow key is not persistent; rechecks are disabled",
    );
  }
  validateRecheckShape(payload);

  const now = Date.now();
  if (Math.abs(now - payload.timestamp) > REQUEST_MAX_AGE_MS) {
    throw new RegistrationError("stale_request", "request timestamp is outside the freshness window");
  }
  const deadline = now + (Number(env.SIXFIGS_REGISTRATION_BUDGET_MS) || DEFAULT_REGISTRATION_BUDGET_MS);

  const escrow = await decryptEnvelope<EscrowPayload>(deps.keys.escrowPrivate, payload.escrowBlob).catch(
    () => {
      throw new RegistrationError("bad_escrow", "escrow blob could not be decrypted");
    },
  );
  if (!escrow || escrow.v !== 1 || !Array.isArray(escrow.wallets) || escrow.wallets.length === 0) {
    throw new RegistrationError("bad_escrow", "escrow payload is malformed");
  }

  const wallets = withLabels(escrow.wallets);
  const walletNullifiers = walletEntriesFromAddresses(wallets, deps.nullifier);
  const idNullifier = walletSetNullifier(walletNullifiers);
  if (idNullifier !== payload.identityNullifier) {
    throw new RegistrationError(
      "identity_mismatch",
      "escrow blob belongs to a different identity",
    );
  }

  let rawBalances: RawBalance[];
  try {
    rawBalances = await collectBalances(wallets, env, deadline, MAX_ASSETS_PER_REQUEST);
  } catch (error) {
    if (error instanceof RpcDisagreementError) {
      throw new RegistrationError("rpc_disagreement", "redundant RPC providers disagree");
    }
    throw error;
  }

  const valued = await valueBalances(rawBalances, deps.pricing, deadline);
  const tiers = tiersForEnv(env);
  const tier = assignTier(valued.totalMicroUsd, tiers);

  const body: RegistrationResultBody = {
    v: 1,
    policyVersion: POLICY_VERSION,
    tier: tier.id,
    tierLabel: tier.label,
    tierFloorMicroUsd: tier.minMicroUsd.toString(),
    nextTierFloorMicroUsd: nextTierFloor(tier.id, tiers).toString(),
    portfolioBand: portfolioBand(valued.totalMicroUsd, tiers),
    stableBps: valued.stableBps,
    topAssets: valued.topAssets,
    disclosure: "hidden",
    allocation: [],
    walletNullifiers,
    identityNullifier: idNullifier,
    createdAt: now,
    expiresAt: now + RESULT_TTL_MS,
    nonce: payload.nonce,
    nullifierScheme: deps.nullifier.name,
  };

  return signBody(body, deps);
}

async function signBody(
  body: RegistrationResultBody,
  deps: RegistrationDeps,
): Promise<SignedRegistration> {
  const canonicalBody = canonicalJson(body);
  const signature = signResult(deps.keys, canonicalBody);

  const { signingPublicKey, keyId } = exportPublicKeys(deps.keys);
  const payloadHash = sha256Hex(`${DOMAIN.enclaveResult}|${canonicalBody}`);
  const nonce = bindingNonce(deps.keys.signingPublic, payloadHash);
  const attestationToken = await deps.attestation.getToken({
    audience: "6figs-registration",
    nonces: [nonce],
    tokenType: "OIDC",
  });

  return {
    v: 1,
    body,
    signature,
    enclavePublicKey: signingPublicKey,
    keyId,
    attestationToken,
    provider: deps.attestation.kind,
  };
}

function tiersForEnv(env: NodeJS.ProcessEnv): ReturnType<typeof activeTiers> {
  return activeTiers(env.SIXFIGS_DEV_CHAINS === "1");
}

function withLabels<
  T extends {
    family: "evm" | "solana";
    address: string;
    chainId: number;
    label?: string;
  },
>(wallets: readonly T[]): T[] {
  return wallets.map((wallet) => {
    const label = wallet.label ? sanitizeWalletLabel(wallet.label) : undefined;
    return { ...wallet, label } as T;
  });
}

interface ValuedBalances {
  allocation: RegistrationResultBody["allocation"];
  stableBps: number;
  totalMicroUsd: bigint;
  topAssets: string[];
}

async function valueBalances(
  rawBalances: readonly RawBalance[],
  pricing: PricingProvider,
  deadline: number,
): Promise<ValuedBalances> {
  const positions: CategorizedPosition[] = [];
  const holdings: ValuedHolding[] = [];
  for (const balance of rawBalances) {
    if (Date.now() > deadline) {
      throw new RegistrationError("budget_exceeded", "registration exceeded its time budget");
    }
    const quote = await pricing.quote(balance);
    if (!quote) continue;
    const value = valueMicroUsd(balance.balanceRaw, quote.priceMicroUsd, balance.decimals);
    if (value === null || value <= 0n) continue;
    positions.push({
      category: categoryForPrice(quote.priceMicroUsd),
      valueMicroUsd: value,
    });
    holdings.push({ symbol: balance.symbol, valueMicroUsd: value });
  }

  const { allocation, stableBps, totalMicroUsd } = computeAllocation(positions);
  return {
    allocation,
    stableBps,
    totalMicroUsd,
    topAssets: topAssetSymbols(holdings, totalMicroUsd),
  };
}

function validateRecheckShape(payload: RecheckPayload): void {
  if (!payload || typeof payload !== "object") {
    throw new RegistrationError("bad_request", "malformed recheck payload");
  }
  if (typeof payload.nonce !== "string" || payload.nonce.length < 8) {
    throw new RegistrationError("bad_request", "nonce missing or too short");
  }
  if (typeof payload.timestamp !== "number") {
    throw new RegistrationError("bad_request", "timestamp missing");
  }
  if (typeof payload.identityNullifier !== "string" || payload.identityNullifier.length === 0) {
    throw new RegistrationError("bad_request", "identityNullifier missing");
  }
  if (!payload.escrowBlob || typeof payload.escrowBlob !== "object") {
    throw new RegistrationError("bad_request", "escrowBlob missing");
  }
}

function validateRequestShape(request: RegistrationRequest): void {
  if (request.mode !== undefined && request.mode !== "establish" && request.mode !== "add") {
    throw new RegistrationError("bad_request", `unsupported registration mode ${String(request.mode)}`);
  }
  if (typeof request.nonce !== "string" || request.nonce.length < 8) {
    throw new RegistrationError("bad_request", "nonce missing or too short");
  }
  if (typeof request.timestamp !== "number") {
    throw new RegistrationError("bad_request", "timestamp missing");
  }
  if (!Array.isArray(request.wallets) || request.wallets.length === 0) {
    throw new RegistrationError("bad_request", "at least one wallet is required");
  }
  const removals = request.removals ?? [];
  if (!Array.isArray(removals)) {
    throw new RegistrationError("bad_request", "removals must be an array");
  }
  if (request.wallets.length + removals.length > MAX_WALLETS) {
    throw new RegistrationError("bad_request", `at most ${MAX_WALLETS} wallets are allowed`);
  }
  for (const wallet of [...request.wallets, ...removals]) {
    if (!wallet || typeof wallet !== "object") {
      throw new RegistrationError("bad_request", "malformed wallet entry");
    }
    if (wallet.family !== "evm" && wallet.family !== "solana") {
      throw new RegistrationError("bad_request", `unsupported wallet family ${String(wallet.family)}`);
    }
    if (typeof wallet.address !== "string" || typeof wallet.signature !== "string") {
      throw new RegistrationError("bad_request", "wallet address and signature must be strings");
    }
  }
  if (!["hidden", "category", "full"].includes(request.disclosure)) {
    throw new RegistrationError("bad_request", "invalid disclosure mode");
  }
}

/**
 * Collect balances for every wallet. When SIXFIGS_DEV_INSECURE_BALANCES is set
 * the function returns deterministic development balances instead of hitting
 * RPCs, which is what local tests and the mock deployment use.
 */
async function collectBalances(
  wallets: readonly Pick<WalletInput, "family" | "address">[],
  env: NodeJS.ProcessEnv,
  deadline: number,
  maxAssets: number,
): Promise<RawBalance[]> {
  if (env.SIXFIGS_DEV_INSECURE_BALANCES === "1") {
    return devBalances(wallets);
  }

  const evmRpcs = evmRpcsFromEnv(env);
  const solanaRpc = httpsUrl(env.SIXFIGS_RPC_SOLANA);
  const solanaSecondary = httpsUrl(env.SIXFIGS_RPC_SOLANA_SECONDARY);
  const balances: RawBalance[] = [];

  // Disagreement is never swallowed: it means a provider may be lying about
  // value-critical reads, so it fails the registration instead.
  const collect = async (work: Promise<RawBalance[]>): Promise<RawBalance[]> =>
    work.catch((error: unknown) => {
      if (error instanceof RpcDisagreementError) throw error;
      return [];
    });

  for (const wallet of wallets) {
    const remaining = maxAssets - balances.length;
    if (remaining <= 0) break;
    if (Date.now() > deadline) {
      throw new RegistrationError("budget_exceeded", "registration exceeded its time budget");
    }
    if (wallet.family === "solana") {
      if (!solanaRpc) continue;
      const sol = await collect(
        discoverSolanaBalances(wallet.address, solanaRpc, remaining, solanaSecondary),
      );
      balances.push(...sol);
    } else {
      if (evmRpcs.length === 0) continue;
      const evm = await collect(discoverEvmBalances(wallet.address, evmRpcs, remaining));
      balances.push(...evm);
    }
  }
  return balances;
}

/** Deterministic balances derived from the address, for dev/test only. */
function devBalances(
  wallets: readonly Pick<WalletInput, "family" | "address">[],
): RawBalance[] {
  const out: RawBalance[] = [];
  for (const wallet of wallets) {
    const hash = sha256Bytes(utf8(wallet.address));
    const base = BigInt(hash[0]!);
    if (wallet.family === "solana") {
      out.push({
        chainId: 0,
        family: "solana",
        asset: "native",
        symbol: "SOL",
        decimals: 9,
        balanceRaw: 10n ** 9n * base,
      });
      continue;
    }
    out.push({
      chainId: 1,
      family: "evm",
      asset: "native",
      symbol: "ETH",
      decimals: 18,
      balanceRaw: 10n ** 18n * base,
    });
  }
  return out;
}