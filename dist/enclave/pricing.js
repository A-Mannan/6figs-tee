import { CHAINS, MAJORS_PRICE_FLOOR_MICRO, PAR_STABLE_BAND_MICRO, VALUE_SCALE, } from "../shared/constants.js";
import { getJson } from "./rpc.js";
const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
function usdToMicro(usd) {
    if (!Number.isFinite(usd) || usd <= 0)
        return 0n;
    return BigInt(Math.round(usd * Number(VALUE_SCALE)));
}
/** Dollar-range assets are treated as par and capped at $1.00. */
export function isParStable(priceMicroUsd) {
    return (priceMicroUsd >= VALUE_SCALE - PAR_STABLE_BAND_MICRO &&
        priceMicroUsd <= VALUE_SCALE + PAR_STABLE_BAND_MICRO);
}
function capAtPar(quote) {
    if (!isParStable(quote.priceMicroUsd))
        return quote;
    return { priceMicroUsd: VALUE_SCALE, derived: true };
}
/**
 * CoinGecko-backed pricing. Native assets are priced via /simple/price by id;
 * ERC-20/SPL tokens via /simple/token_price/{platform} by contract address.
 * There is no token allowlist: every discovered asset is quoted, and any asset
 * the API cannot price is skipped rather than valued at a guess.
 * Requests are cached per instance for a short TTL to stay within rate limits.
 */
export class CoinGeckoPricing {
    cache = new Map();
    ttlMs;
    headers;
    fallback;
    constructor(options = {}) {
        this.ttlMs = options.ttlMs ?? 120_000;
        this.headers = options.apiKey
            ? { "x-cg-demo-api-key": options.apiKey }
            : {};
        this.fallback = options.fallback ?? null;
    }
    async quote(balance) {
        const key = `${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.at < this.ttlMs)
            return cached.quote;
        const quote = (await this.fetchQuote(balance)) ??
            (this.fallback ? await this.fallback.quote(balance) : null);
        if (quote)
            this.cache.set(key, { at: Date.now(), quote });
        return quote;
    }
    async fetchQuote(balance) {
        if (balance.asset === "native")
            return this.nativeQuote(balance);
        const quote = await this.tokenQuote(balance).catch(() => null);
        return quote ? capAtPar(quote) : null;
    }
    async nativeQuote(balance) {
        const chain = CHAINS.find((c) => c.chainId === balance.chainId && c.family === balance.family);
        const id = chain?.nativePriceId;
        if (!id)
            return null;
        const data = await getJson(`${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`, this.headers);
        const usd = data[id]?.usd;
        if (usd === undefined)
            return null;
        const priceMicroUsd = usdToMicro(usd);
        return priceMicroUsd > 0n ? { priceMicroUsd, derived: false } : null;
    }
    async tokenQuote(balance) {
        if (balance.family === "solana") {
            const data = await getJson(`${COINGECKO_BASE}/simple/token_price/solana?contract_addresses=${encodeURIComponent(balance.asset)}&vs_currencies=usd`, this.headers);
            const entry = data[balance.asset] ?? data[balance.asset.toLowerCase()];
            const usd = entry?.usd;
            if (usd === undefined)
                return null;
            const priceMicroUsd = usdToMicro(usd);
            return priceMicroUsd > 0n ? { priceMicroUsd, derived: false } : null;
        }
        const chain = CHAINS.find((c) => c.chainId === balance.chainId && c.family === "evm");
        const platform = chain?.coingeckoPlatform;
        if (!platform)
            return null;
        const address = balance.asset.toLowerCase();
        const data = await getJson(`${COINGECKO_BASE}/simple/token_price/${encodeURIComponent(platform)}?contract_addresses=${encodeURIComponent(address)}&vs_currencies=usd`, this.headers);
        const entry = data[address] ?? data[balance.asset];
        const usd = entry?.usd;
        if (usd === undefined)
            return null;
        const priceMicroUsd = usdToMicro(usd);
        return priceMicroUsd > 0n ? { priceMicroUsd, derived: false } : null;
    }
}
/**
 * Fixed-price provider for tests and offline development. Assets use
 * `prices[assetKey]`, defaulting to the provided default price for native
 * assets. Assets with no configured price return null (skipped).
 */
export class StaticPricing {
    prices;
    defaultUsd;
    constructor(prices, defaultUsd = 0) {
        this.prices = prices;
        this.defaultUsd = defaultUsd;
    }
    async quote(balance) {
        const key = `${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
        const usd = this.prices[key] ?? (balance.asset === "native" ? this.defaultUsd : 0);
        const priceMicroUsd = usdToMicro(usd);
        if (priceMicroUsd <= 0n)
            return null;
        const quote = { priceMicroUsd, derived: false };
        return balance.asset === "native" ? quote : capAtPar(quote);
    }
}
export function categoryForPrice(priceMicroUsd) {
    if (isParStable(priceMicroUsd))
        return "stable";
    if (priceMicroUsd >= MAJORS_PRICE_FLOOR_MICRO)
        return "majors";
    return "altcoins";
}
