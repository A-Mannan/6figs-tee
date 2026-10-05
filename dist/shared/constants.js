/**
 * Protocol-wide constants. Everything here is public and is committed into the
 * signed registration result via POLICY_VERSION so clients and backends can
 * detect a mismatch with what the enclave actually ran.
 */
/** USD values are carried as integer micro-dollars (1e-6 USD) to avoid floats. */
export const VALUE_SCALE = 1000000n;
/**
 * Tier thresholds. Lower-bound semantics: a wallet qualifies for the highest
 * tier whose minimum it meets. The enclave never reveals the exact total, only
 * the band, so a lower-bound tier leaks at most one bit of bucket membership.
 */
export const TIERS = [
    { id: 0, label: "none", minMicroUsd: 0n },
    { id: 1, label: "$100k+", minMicroUsd: 100000n * VALUE_SCALE },
    { id: 2, label: "$300k+", minMicroUsd: 300000n * VALUE_SCALE },
    { id: 3, label: "$500k+", minMicroUsd: 500000n * VALUE_SCALE },
    { id: 4, label: "$1M+", minMicroUsd: 1000000n * VALUE_SCALE },
];
/**
 * Dev tier thresholds mirror the product's devnet tiers (10/100/500/1000 USD),
 * enabled only when dev chains are active, so faucet-funded dev wallets prove
 * real tiers through the same code path. Never used in production.
 */
export const DEV_TIERS = [
    { id: 0, label: "none", minMicroUsd: 0n },
    { id: 1, label: "$10+", minMicroUsd: 10n * VALUE_SCALE },
    { id: 2, label: "$100+", minMicroUsd: 100n * VALUE_SCALE },
    { id: 3, label: "$500+", minMicroUsd: 500n * VALUE_SCALE },
    { id: 4, label: "$1k+", minMicroUsd: 1000n * VALUE_SCALE },
];
/** Tier set to evaluate against; dev thresholds only with SIXFIGS_DEV_CHAINS=1. */
export function activeTiers(devEnabled) {
    return devEnabled ? DEV_TIERS : TIERS;
}
/** Up to three asset symbols are disclosed; each must hold this share. */
export const MAX_TOP_ASSETS = 3;
export const TOP_ASSETS_MIN_BPS = 500;
export const MAX_WALLET_LABEL = 32;
/** Allocation categories used for category-level disclosure. */
export const ALLOCATION_CATEGORIES = ["stable", "majors", "altcoins", "other"];
export const POLICY_VERSION = "6figs-tee-2026-10-d";
/** Domain-separation tags. Changing any of these breaks all existing nullifiers. */
export const DOMAIN = {
    identity: "6figs-identity-v2",
    wallet: "6figs-wallet-v1",
    walletV2: "6figs-wallet-v2",
    ownership: "6figs-ownership-v1",
    walletRemoval: "6figs-wallet-removal-v1",
    walletThresholdRemoval: "6figs-wallet-threshold-removal-v1",
    walletAddition: "6figs-wallet-add-v1",
    enclaveKey: "6figs-enclave-key-v1",
    enclaveResult: "6figs-registration-v1",
    envelope: "6figs-envelope-v1",
    nonce: "6figs-nonce-v1",
};
/**
 * Human-readable message wallets sign to prove control of an address. Lists
 * every wallet in the authorized set so a signer can see exactly what
 * membership the signature approves; the identity commitment binds the set.
 */
export function ownershipChallenge(params) {
    const members = params.wallets
        .map((wallet) => wallet.family === "evm"
        ? `  evm:${wallet.address.toLowerCase()}`
        : `  solana:${wallet.address}`)
        .sort();
    return [
        "6figs: prove wallet ownership",
        "",
        `Domain: ${DOMAIN.ownership}`,
        `Identity: ${params.identityNullifier}`,
        "Wallets:",
        ...members,
        `Nonce: ${params.nonce}`,
        `Issued At: ${new Date(params.timestamp).toISOString()}`,
        "",
        "Signing this message proves you control the listed wallets. It moves no funds.",
    ].join("\n");
}
/**
 * Message a wallet signs to join an existing account. Compact by design: it
 * names the account's identity pseudonym and this wallet only, so the message
 * does not grow with the stored set and an old wallet is never needed. The
 * enclave recomputes the account identity from the escrow blob, so a forged
 * account value cannot redirect the addition.
 */
export function walletAdditionChallenge(params) {
    const wallet = params.family === "evm" ? params.address.toLowerCase() : params.address;
    return [
        "6figs: add a wallet to your account",
        "",
        `Domain: ${DOMAIN.walletAddition}`,
        `Account: ${params.accountIdentityNullifier}`,
        `Wallet: ${wallet}`,
        `Nonce: ${params.nonce}`,
        `Issued At: ${new Date(params.timestamp).toISOString()}`,
        "",
        "Signing this adds this wallet to the account. It moves no funds.",
    ].join("\n");
}
/**
 * Message every kept wallet signs to evict one or more wallets. The removed
 * wallet signs nothing, which is what makes a lost wallet recoverable. Names
 * the account pseudonym and the removed wallet(s); kept wallets are implied by
 * who signs, so the message does not grow with the kept set.
 */
export function walletThresholdRemovalChallenge(params) {
    const removed = params.removals
        .map((wallet) => wallet.family === "evm"
        ? `  evm:${wallet.address.toLowerCase()}`
        : `  solana:${wallet.address}`)
        .sort();
    return [
        "6figs: remove wallet(s) from your account",
        "",
        `Domain: ${DOMAIN.walletThresholdRemoval}`,
        `Account: ${params.accountIdentityNullifier}`,
        "Removing:",
        ...removed,
        `Nonce: ${params.nonce}`,
        `Issued At: ${new Date(params.timestamp).toISOString()}`,
        "",
        "Signing this removes the listed wallets from the account. It moves no funds.",
    ].join("\n");
}
/**
 * Message a wallet signs to detach itself from an account. Bound to the new
 * (kept) set commitment plus the request nonce, so the consent applies to
 * exactly one transition and cannot be reused as an ownership proof. The
 * previous identity is inferred by the backend from its stored bindings, never
 * claimed by the client.
 */
export function walletRemovalChallenge(params) {
    const wallet = params.family === "evm" ? params.address.toLowerCase() : params.address;
    return [
        "6figs: remove this wallet from the account",
        "",
        `Domain: ${DOMAIN.walletRemoval}`,
        `Wallet: ${wallet}`,
        `Next Identity: ${params.nextIdentityNullifier}`,
        `Nonce: ${params.nonce}`,
        `Issued At: ${new Date(params.timestamp).toISOString()}`,
        "",
        "Signing this detaches this wallet from the account. It moves no funds.",
    ].join("\n");
}
export const CHAINS = [
    {
        family: "evm",
        chainId: 1,
        name: "ethereum",
        nativeSymbol: "ETH",
        nativePriceId: "ethereum",
        coingeckoPlatform: "ethereum",
        geckoterminalNetwork: "eth",
        dexscreenerChainId: "ethereum",
        nativeDecimals: 18,
        defaultRpcEnv: "SIXFIGS_RPC_ETHEREUM",
    },
    {
        family: "evm",
        chainId: 8453,
        name: "base",
        nativeSymbol: "ETH",
        nativePriceId: "ethereum",
        coingeckoPlatform: "base",
        geckoterminalNetwork: "base",
        dexscreenerChainId: "base",
        nativeDecimals: 18,
        defaultRpcEnv: "SIXFIGS_RPC_BASE",
    },
    {
        family: "evm",
        chainId: 42161,
        name: "arbitrum",
        nativeSymbol: "ETH",
        nativePriceId: "ethereum",
        coingeckoPlatform: "arbitrum-one",
        geckoterminalNetwork: "arbitrum",
        dexscreenerChainId: "arbitrum",
        nativeDecimals: 18,
        defaultRpcEnv: "SIXFIGS_RPC_ARBITRUM",
    },
    {
        family: "evm",
        chainId: 10,
        name: "optimism",
        nativeSymbol: "ETH",
        nativePriceId: "ethereum",
        coingeckoPlatform: "optimistic-ethereum",
        geckoterminalNetwork: "optimism",
        dexscreenerChainId: "optimism",
        nativeDecimals: 18,
        defaultRpcEnv: "SIXFIGS_RPC_OPTIMISM",
    },
    {
        family: "evm",
        chainId: 137,
        name: "polygon",
        nativeSymbol: "POL",
        nativePriceId: "matic-network",
        coingeckoPlatform: "polygon-pos",
        geckoterminalNetwork: "polygon_pos",
        dexscreenerChainId: "polygon",
        nativeDecimals: 18,
        defaultRpcEnv: "SIXFIGS_RPC_POLYGON",
    },
    {
        family: "solana",
        chainId: 0,
        name: "solana",
        nativeSymbol: "SOL",
        nativePriceId: "solana",
        coingeckoPlatform: "solana",
        geckoterminalNetwork: "solana",
        dexscreenerChainId: "solana",
        nativeDecimals: 9,
        defaultRpcEnv: "SIXFIGS_RPC_SOLANA",
    },
];
/**
 * Testnet chains, enabled only when `SIXFIGS_DEV_CHAINS=1`. Devnet assets are
 * worthless, so these entries must never enter valuation or attestation
 * policy in production; a reset dev chain can mint arbitrary balances.
 */
export const DEV_CHAINS = [
    {
        family: "evm",
        chainId: 11155111,
        name: "sepolia",
        nativeSymbol: "ETH",
        nativePriceId: "ethereum",
        coingeckoPlatform: "ethereum",
        nativeDecimals: 18,
        defaultRpcEnv: "SIXFIGS_RPC_SEPOLIA",
    },
];
export function activeChains(devEnabled) {
    return devEnabled ? [...CHAINS, ...DEV_CHAINS] : CHAINS;
}
/**
 * There is deliberately no token allowlist. Every token the discovery layer
 * finds is priced; anything the price API cannot quote is skipped rather than
 * valued at a guess. Assets trading within the par band are treated as
 * dollar-pegged and capped at $1.00.
 */
export const PAR_STABLE_BAND_MICRO = 10000n;
/** A token with a live price above this many micro-USD is "majors". */
export const MAJORS_PRICE_FLOOR_MICRO = 50n * VALUE_SCALE;
/**
 * Upper bound on assets valued per registration. A wallet can receive an
 * unbounded number of spam tokens; without a cap, one request can exhaust RPC
 * and price-provider quotas. Beyond this, holdings are ignored (undercounting,
 * never inflating).
 */
export const MAX_ASSETS_PER_REQUEST = 300;
