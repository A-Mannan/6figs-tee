/**
 * Protocol-wide constants. Everything here is public and is committed into the
 * signed registration result via POLICY_VERSION so clients and backends can
 * detect a mismatch with what the enclave actually ran.
 */
/** USD values are carried as integer micro-dollars (1e-6 USD) to avoid floats. */
export declare const VALUE_SCALE = 1000000n;
export interface TierDefinition {
    /** 0 means "below the first threshold" (not admitted). */
    readonly id: number;
    readonly label: string;
    /** Minimum inclusive portfolio value in micro-USD. */
    readonly minMicroUsd: bigint;
}
/**
 * Tier thresholds. Lower-bound semantics: a wallet qualifies for the highest
 * tier whose minimum it meets. The enclave never reveals the exact total, only
 * the band, so a lower-bound tier leaks at most one bit of bucket membership.
 */
export declare const TIERS: readonly TierDefinition[];
/**
 * Dev tier thresholds mirror the product's devnet tiers (10/100/500/1000 USD),
 * enabled only when dev chains are active, so faucet-funded dev wallets prove
 * real tiers through the same code path. Never used in production.
 */
export declare const DEV_TIERS: readonly TierDefinition[];
/** Tier set to evaluate against; dev thresholds only with SIXFIGS_DEV_CHAINS=1. */
export declare function activeTiers(devEnabled: boolean): readonly TierDefinition[];
/** Up to three asset symbols are disclosed; each must hold this share. */
export declare const MAX_TOP_ASSETS = 3;
export declare const TOP_ASSETS_MIN_BPS = 500;
export declare const MAX_WALLET_LABEL = 32;
/** Allocation categories used for category-level disclosure. */
export declare const ALLOCATION_CATEGORIES: readonly ["stable", "majors", "altcoins", "other"];
export type AllocationCategory = (typeof ALLOCATION_CATEGORIES)[number];
export declare const POLICY_VERSION = "6figs-tee-2026-10-c";
/** Domain-separation tags. Changing any of these breaks all existing nullifiers. */
export declare const DOMAIN: {
    readonly identity: "6figs-identity-v2";
    readonly wallet: "6figs-wallet-v1";
    readonly walletV2: "6figs-wallet-v2";
    readonly ownership: "6figs-ownership-v1";
    readonly walletRemoval: "6figs-wallet-removal-v1";
    readonly walletAddition: "6figs-wallet-add-v1";
    readonly enclaveKey: "6figs-enclave-key-v1";
    readonly enclaveResult: "6figs-registration-v1";
    readonly envelope: "6figs-envelope-v1";
    readonly nonce: "6figs-nonce-v1";
};
/**
 * Human-readable message wallets sign to prove control of an address. Lists
 * every wallet in the authorized set so a signer can see exactly what
 * membership the signature approves; the identity commitment binds the set.
 */
export declare function ownershipChallenge(params: {
    identityNullifier: string;
    wallets: readonly {
        family: "evm" | "solana";
        address: string;
    }[];
    timestamp: number;
    nonce: string;
}): string;
/**
 * Message a wallet signs to join an existing account. Compact by design: it
 * names the account's identity pseudonym and this wallet only, so the message
 * does not grow with the stored set and an old wallet is never needed. The
 * enclave recomputes the account identity from the escrow blob, so a forged
 * account value cannot redirect the addition.
 */
export declare function walletAdditionChallenge(params: {
    family: "evm" | "solana";
    address: string;
    accountIdentityNullifier: string;
    timestamp: number;
    nonce: string;
}): string;
/**
 * Message a wallet signs to detach itself from an account. Bound to the new
 * (kept) set commitment plus the request nonce, so the consent applies to
 * exactly one transition and cannot be reused as an ownership proof. The
 * previous identity is inferred by the backend from its stored bindings, never
 * claimed by the client.
 */
export declare function walletRemovalChallenge(params: {
    family: "evm" | "solana";
    address: string;
    nextIdentityNullifier: string;
    timestamp: number;
    nonce: string;
}): string;
/** How much of the portfolio the result carries. Defaults to hidden. */
export type Disclosure = "hidden" | "category" | "full";
/** Chain descriptor for the supported networks. */
export interface ChainConfig {
    readonly family: "evm" | "solana";
    /** EVM chain id, or 0 for Solana. */
    readonly chainId: number;
    readonly name: string;
    readonly nativeSymbol: string;
    /** CoinGecko id for the native asset. */
    readonly nativePriceId: string;
    /** CoinGecko "platform" slug for token price lookups. */
    readonly coingeckoPlatform: string;
    readonly nativeDecimals: number;
    readonly defaultRpcEnv: string;
}
export declare const CHAINS: readonly ChainConfig[];
/**
 * Testnet chains, enabled only when `SIXFIGS_DEV_CHAINS=1`. Devnet assets are
 * worthless, so these entries must never enter valuation or attestation
 * policy in production; a reset dev chain can mint arbitrary balances.
 */
export declare const DEV_CHAINS: readonly ChainConfig[];
export declare function activeChains(devEnabled: boolean): readonly ChainConfig[];
/**
 * There is deliberately no token allowlist. Every token the discovery layer
 * finds is priced; anything the price API cannot quote is skipped rather than
 * valued at a guess. Assets trading within the par band are treated as
 * dollar-pegged and capped at $1.00.
 */
export declare const PAR_STABLE_BAND_MICRO = 10000n;
/** A token with a live price above this many micro-USD is "majors". */
export declare const MAJORS_PRICE_FLOOR_MICRO: bigint;
/**
 * Upper bound on assets valued per registration. A wallet can receive an
 * unbounded number of spam tokens; without a cap, one request can exhaust RPC
 * and price-provider quotas. Beyond this, holdings are ignored (undercounting,
 * never inflating).
 */
export declare const MAX_ASSETS_PER_REQUEST = 300;
