import type { RawBalance } from "./balances.ts";
export interface PriceQuote {
    /** Price in micro-USD. */
    priceMicroUsd: bigint;
    /** True when the value was derived rather than observed (stable floor). */
    derived: boolean;
}
export interface PricingProvider {
    quote(balance: RawBalance): Promise<PriceQuote | null>;
    /**
     * Batched variant. Providers without one are fanned out by quoteAll with
     * bounded parallelism; results are keyed by priceKey, null when unpriceable.
     */
    quoteMany?(balances: readonly RawBalance[]): Promise<Map<string, PriceQuote | null>>;
}
/** Canonical per-asset key shared by batching, caches, and result maps. */
export declare function priceKey(balance: Pick<RawBalance, "family" | "chainId" | "asset">): string;
/**
 * Quote every balance. Batching providers resolve in a handful of grouped
 * calls; the rest fan out with bounded parallelism. Either way the caller
 * gets one map lookup per asset instead of N sequential round trips.
 */
export declare function quoteAll(pricing: PricingProvider, balances: readonly RawBalance[], concurrency?: number): Promise<Map<string, PriceQuote | null>>;
/** Dollar-range assets are treated as par and capped at $1.00. */
export declare function isParStable(priceMicroUsd: bigint): boolean;
/**
 * CoinGecko-backed pricing. Native assets are priced via /simple/price by id;
 * ERC-20/SPL tokens via /simple/token_price/{platform} by contract address.
 * There is no token allowlist: every discovered asset is quoted, and any asset
 * the API cannot price is skipped rather than valued at a guess.
 *
 * Requests are batched by platform (one call per chain group plus one for
 * natives) instead of one call per asset: fewer round trips for the same
 * data, and proportionally less pressure on the API's rate limit. Results —
 * hits and misses alike — are cached per instance for a short TTL, so repeat
 * proves and rechecks within the window cost no provider calls at all.
 */
export declare class CoinGeckoPricing implements PricingProvider {
    private readonly cache;
    private readonly ttlMs;
    private readonly headers;
    private readonly fallback;
    private readonly chains;
    constructor(options?: {
        apiKey?: string;
        ttlMs?: number;
        fallback?: PricingProvider;
        /** Include devnet chains; never enable where testnet value matters. */
        devChains?: boolean;
    });
    quote(balance: RawBalance): Promise<PriceQuote | null>;
    quoteMany(balances: readonly RawBalance[]): Promise<Map<string, PriceQuote | null>>;
    /** One grouped call per platform plus one for natives; chunk failures fall
     * back to the original per-asset calls, preserving their exact semantics
     * (native failures throw, token failures flow to the fallback chain). */
    private fetchBatches;
    private fetchNativeBatch;
    private fetchTokenBatch;
    private nativeQuote;
    private tokenQuote;
}
/**
 * GeckoTerminal token prices by network and contract address. Covers assets
 * with live DEX pools that CoinGecko has not indexed; anything without a pool
 * returns null and the next fallback is tried.
 */
export declare class GeckoTerminalPricing implements PricingProvider {
    private readonly cache;
    private readonly ttlMs;
    private readonly headers;
    private readonly fallback;
    private readonly chains;
    constructor(options?: {
        apiKey?: string;
        ttlMs?: number;
        fallback?: PricingProvider;
        devChains?: boolean;
    });
    quote(balance: RawBalance): Promise<PriceQuote | null>;
    private fetchQuote;
}
/**
 * DexScreener token prices across pairs. When a token trades on several
 * chains, the pair on the balance's chain with the deepest liquidity wins.
 */
export declare class DexScreenerPricing implements PricingProvider {
    private readonly cache;
    private readonly ttlMs;
    private readonly chains;
    constructor(options?: {
        ttlMs?: number;
        devChains?: boolean;
    });
    quote(balance: RawBalance): Promise<PriceQuote | null>;
    private fetchQuote;
}
/**
 * Fixed-price provider for tests and offline development. Assets use
 * `prices[assetKey]`, defaulting to the provided default price for native
 * assets. Assets with no configured price return null (skipped).
 */
export declare class StaticPricing implements PricingProvider {
    private readonly prices;
    private readonly defaultUsd;
    constructor(prices: Record<string, number>, defaultUsd?: number);
    quote(balance: RawBalance): Promise<PriceQuote | null>;
}
export declare function categoryForPrice(priceMicroUsd: bigint): "stable" | "majors" | "altcoins";
