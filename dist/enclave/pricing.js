import { activeChains, MAJORS_PRICE_FLOOR_MICRO, PAR_STABLE_BAND_MICRO, VALUE_SCALE, } from "../shared/constants.js";
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
    chains;
    constructor(options = {}) {
        this.ttlMs = options.ttlMs ?? 120_000;
        this.headers = options.apiKey
            ? { "x-cg-demo-api-key": options.apiKey }
            : {};
        this.fallback = options.fallback ?? null;
        this.chains = activeChains(options.devChains ?? false);
    }
    async quote(balance) {
        const key = `${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.at < this.ttlMs)
            return cached.quote;
        const raw = (await this.fetchQuote(balance)) ??
            (this.fallback ? await this.fallback.quote(balance) : null);
        // The par cap applies to whichever provider produced the quote, so a DEX
        // fallback cannot bypass it. Native assets are never par-capped.
        const quote = raw && balance.asset !== "native" ? capAtPar(raw) : raw;
        if (quote)
            this.cache.set(key, { at: Date.now(), quote });
        return quote;
    }
    async fetchQuote(balance) {
        if (balance.asset === "native")
            return this.nativeQuote(balance);
        return this.tokenQuote(balance).catch(() => null);
    }
    async nativeQuote(balance) {
        const chain = this.chains.find((c) => c.chainId === balance.chainId && c.family === balance.family);
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
        const chain = this.chains.find((c) => c.chainId === balance.chainId && c.family === "evm");
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
const GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2";
const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex";
function parseUsd(value) {
    if (value === undefined)
        return 0n;
    const usd = typeof value === "number" ? value : Number(value);
    return usdToMicro(usd);
}
/**
 * GeckoTerminal token prices by network and contract address. Covers assets
 * with live DEX pools that CoinGecko has not indexed; anything without a pool
 * returns null and the next fallback is tried.
 */
export class GeckoTerminalPricing {
    cache = new Map();
    ttlMs;
    headers;
    fallback;
    chains;
    constructor(options = {}) {
        this.ttlMs = options.ttlMs ?? 120_000;
        this.headers = options.apiKey ? { "x-api-key": options.apiKey } : {};
        this.fallback = options.fallback ?? null;
        this.chains = activeChains(options.devChains ?? false);
    }
    async quote(balance) {
        const key = `gt:${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.at < this.ttlMs)
            return cached.quote;
        const quote = (balance.asset === "native" ? null : await this.fetchQuote(balance)) ??
            (this.fallback ? await this.fallback.quote(balance) : null);
        if (quote)
            this.cache.set(key, { at: Date.now(), quote });
        return quote;
    }
    async fetchQuote(balance) {
        const chain = this.chains.find((c) => c.chainId === balance.chainId && c.family === balance.family);
        const network = chain?.geckoterminalNetwork;
        if (!network)
            return null;
        const address = balance.family === "evm" ? balance.asset.toLowerCase() : balance.asset;
        const data = await getJson(`${GECKOTERMINAL_BASE}/simple/networks/${encodeURIComponent(network)}/token_price/${encodeURIComponent(address)}`, this.headers).catch(() => null);
        const prices = data?.data?.attributes?.token_prices;
        if (!prices)
            return null;
        const entry = prices[address] ??
            prices[address.toLowerCase()] ??
            Object.entries(prices).find(([k]) => k.toLowerCase() === address.toLowerCase())?.[1];
        const priceMicroUsd = parseUsd(entry);
        return priceMicroUsd > 0n ? { priceMicroUsd, derived: false } : null;
    }
}
/**
 * DexScreener token prices across pairs. When a token trades on several
 * chains, the pair on the balance's chain with the deepest liquidity wins.
 */
export class DexScreenerPricing {
    cache = new Map();
    ttlMs;
    chains;
    constructor(options = {}) {
        this.ttlMs = options.ttlMs ?? 120_000;
        this.chains = activeChains(options.devChains ?? false);
    }
    async quote(balance) {
        if (balance.asset === "native")
            return null;
        const key = `ds:${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.at < this.ttlMs)
            return cached.quote;
        const quote = await this.fetchQuote(balance);
        if (quote)
            this.cache.set(key, { at: Date.now(), quote });
        return quote;
    }
    async fetchQuote(balance) {
        const chain = this.chains.find((c) => c.chainId === balance.chainId && c.family === balance.family);
        const chainId = chain?.dexscreenerChainId;
        if (!chainId)
            return null;
        const address = balance.family === "evm" ? balance.asset.toLowerCase() : balance.asset;
        const data = await getJson(`${DEXSCREENER_BASE}/tokens/${encodeURIComponent(address)}`).catch(() => null);
        const pairs = (data?.pairs ?? []).filter((pair) => pair.chainId === chainId && parseUsd(pair.priceUsd) > 0n);
        if (pairs.length === 0)
            return null;
        const best = pairs.reduce((top, pair) => (pair.liquidity?.usd ?? 0) > (top.liquidity?.usd ?? 0) ? pair : top);
        return { priceMicroUsd: parseUsd(best.priceUsd), derived: false };
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
