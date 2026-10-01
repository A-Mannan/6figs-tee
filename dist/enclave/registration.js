import { activeTiers, DOMAIN, MAX_ASSETS_PER_REQUEST, POLICY_VERSION, walletRemovalChallenge, } from "../shared/constants.js";
import { decryptEnvelope } from "../shared/envelope.js";
import { canonicalJson, sha256Bytes, sha256Hex, utf8, } from "../shared/crypto.js";
import { LEGACY_NULLIFIER_SCHEME, walletEntriesFromAddresses, walletSetNullifier, } from "../shared/nullifiers.js";
import { assignTier, computeAllocation, nextTierFloor, portfolioBand, sanitizeWalletLabel, topAssetSymbols, valueMicroUsd, } from "../shared/tier.js";
import { bindingNonce, exportPublicKeys, signResult, } from "../shared/attestation.js";
import { verifyOwnership, verifyWalletSignature } from "./ownership.js";
import { discoverEvmBalances, evmRpcsFromEnv, httpsUrl, } from "./balances.js";
import { RpcDisagreementError } from "./rpc.js";
import { discoverSolanaBalances } from "./solana.js";
import { categoryForPrice } from "./pricing.js";
const REQUEST_MAX_AGE_MS = 120_000;
const MAX_WALLETS = 20;
const RESULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REGISTRATION_BUDGET_MS = 30_000;
export class RegistrationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
export async function registerPortfolio(request, deps) {
    const env = deps.env ?? process.env;
    validateRequestShape(request);
    const now = Date.now();
    if (Math.abs(now - request.timestamp) > REQUEST_MAX_AGE_MS) {
        throw new RegistrationError("stale_request", "request timestamp is outside the freshness window");
    }
    const deadline = now + (Number(env.SIXFIGS_REGISTRATION_BUDGET_MS) || DEFAULT_REGISTRATION_BUDGET_MS);
    const removals = request.removals ?? [];
    const labeledWallets = withLabels(request.wallets);
    const walletNullifiers = walletEntriesFromAddresses(labeledWallets, deps.nullifier);
    const removedNullifiers = walletEntriesFromAddresses(removals, deps.nullifier);
    const seen = new Set();
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
    const challengeId = walletSetNullifier(walletEntriesFromAddresses(request.wallets, LEGACY_NULLIFIER_SCHEME));
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
            throw new RegistrationError("ownership_failed", `wallet ownership check failed: ${result.reason}`);
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
            throw new RegistrationError("removal_failed", `wallet removal check failed: ${result.reason}`);
        }
    }
    // 2. Balances: discover across all configured chains for each address.
    // The asset budget bounds provider work; the deadline drops the request
    // instead of silently pricing a subset. Provider disagreement fails the
    // request rather than trusting either side.
    let rawBalances;
    try {
        rawBalances = await collectBalances(request.wallets, env, deadline, MAX_ASSETS_PER_REQUEST);
    }
    catch (error) {
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
    const body = {
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
 * Recheck a stored escrow blob: decrypt with the enclave escrow key, refuse a
 * blob whose recomputed identity differs from the claimed one, re-fetch
 * balances and prices, and return a fresh signed, attested result. Possession
 * of the blob is the capability; no wallet signatures are required.
 */
export async function recheckPortfolio(payload, deps) {
    const env = deps.env ?? process.env;
    if (!deps.escrowPersistent) {
        throw new RegistrationError("escrow_unavailable", "escrow key is not persistent; rechecks are disabled");
    }
    validateRecheckShape(payload);
    const now = Date.now();
    if (Math.abs(now - payload.timestamp) > REQUEST_MAX_AGE_MS) {
        throw new RegistrationError("stale_request", "request timestamp is outside the freshness window");
    }
    const deadline = now + (Number(env.SIXFIGS_REGISTRATION_BUDGET_MS) || DEFAULT_REGISTRATION_BUDGET_MS);
    const escrow = await decryptEnvelope(deps.keys.escrowPrivate, payload.escrowBlob).catch(() => {
        throw new RegistrationError("bad_escrow", "escrow blob could not be decrypted");
    });
    if (!escrow || escrow.v !== 1 || !Array.isArray(escrow.wallets) || escrow.wallets.length === 0) {
        throw new RegistrationError("bad_escrow", "escrow payload is malformed");
    }
    const wallets = withLabels(escrow.wallets);
    const walletNullifiers = walletEntriesFromAddresses(wallets, deps.nullifier);
    const idNullifier = walletSetNullifier(walletNullifiers);
    if (idNullifier !== payload.identityNullifier) {
        throw new RegistrationError("identity_mismatch", "escrow blob belongs to a different identity");
    }
    let rawBalances;
    try {
        rawBalances = await collectBalances(wallets, env, deadline, MAX_ASSETS_PER_REQUEST);
    }
    catch (error) {
        if (error instanceof RpcDisagreementError) {
            throw new RegistrationError("rpc_disagreement", "redundant RPC providers disagree");
        }
        throw error;
    }
    const valued = await valueBalances(rawBalances, deps.pricing, deadline);
    const tiers = tiersForEnv(env);
    const tier = assignTier(valued.totalMicroUsd, tiers);
    const body = {
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
async function signBody(body, deps) {
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
function tiersForEnv(env) {
    return activeTiers(env.SIXFIGS_DEV_CHAINS === "1");
}
function withLabels(wallets) {
    return wallets.map((wallet) => {
        const label = wallet.label ? sanitizeWalletLabel(wallet.label) : null;
        return {
            family: wallet.family,
            address: wallet.address,
            chainId: wallet.chainId,
            ...(label ? { label } : {}),
        };
    });
}
async function valueBalances(rawBalances, pricing, deadline) {
    const positions = [];
    const holdings = [];
    for (const balance of rawBalances) {
        if (Date.now() > deadline) {
            throw new RegistrationError("budget_exceeded", "registration exceeded its time budget");
        }
        const quote = await pricing.quote(balance);
        if (!quote)
            continue;
        const value = valueMicroUsd(balance.balanceRaw, quote.priceMicroUsd, balance.decimals);
        if (value === null || value <= 0n)
            continue;
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
function validateRecheckShape(payload) {
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
function validateRequestShape(request) {
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
async function collectBalances(wallets, env, deadline, maxAssets) {
    if (env.SIXFIGS_DEV_INSECURE_BALANCES === "1") {
        return devBalances(wallets);
    }
    const evmRpcs = evmRpcsFromEnv(env);
    const solanaRpc = httpsUrl(env.SIXFIGS_RPC_SOLANA);
    const solanaSecondary = httpsUrl(env.SIXFIGS_RPC_SOLANA_SECONDARY);
    const balances = [];
    // Disagreement is never swallowed: it means a provider may be lying about
    // value-critical reads, so it fails the registration instead.
    const collect = async (work) => work.catch((error) => {
        if (error instanceof RpcDisagreementError)
            throw error;
        return [];
    });
    for (const wallet of wallets) {
        const remaining = maxAssets - balances.length;
        if (remaining <= 0)
            break;
        if (Date.now() > deadline) {
            throw new RegistrationError("budget_exceeded", "registration exceeded its time budget");
        }
        if (wallet.family === "solana") {
            if (!solanaRpc)
                continue;
            const sol = await collect(discoverSolanaBalances(wallet.address, solanaRpc, remaining, solanaSecondary));
            balances.push(...sol);
        }
        else {
            if (evmRpcs.length === 0)
                continue;
            const evm = await collect(discoverEvmBalances(wallet.address, evmRpcs, remaining));
            balances.push(...evm);
        }
    }
    return balances;
}
/** Deterministic balances derived from the address, for dev/test only. */
function devBalances(wallets) {
    const out = [];
    for (const wallet of wallets) {
        const hash = sha256Bytes(utf8(wallet.address));
        const base = BigInt(hash[0]);
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
