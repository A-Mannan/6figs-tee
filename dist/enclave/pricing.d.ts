import type { RawBalance } from "./balances.ts";
export interface PriceQuote {
    /** Price in micro-USD. */
    priceMicroUsd: bigint;
    /** True when the value was derived rather than observed (stable floor). */
    derived: boolean;
}
export interface PricingProvider {
    quote(balance: RawBalance): Promise<PriceQuote | null>;
}
/** Dollar-range assets are treated as par and capped at $1.00. */
export declare function isParStable(priceMicroUsd: bigint): boolean;
/**
 * CoinGecko-backed pricing. Native assets are priced via /simple/price by id;
 * ERC-20/SPL tokens via /simple/token_price/{platform} by contract address.
 * There is no token allowlist: every discovered asset is quoted, and any asset
 * the API cannot price is skipped rather than valued at a guess.
 * Requests are cached per instance for a short TTL to stay within rate limits.
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
    private fetchQuote;
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
