import {
  activeChains,
  MAJORS_PRICE_FLOOR_MICRO,
  PAR_STABLE_BAND_MICRO,
  VALUE_SCALE,
  type ChainConfig,
} from "../shared/constants.ts";
import { getJson } from "./rpc.ts";
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
export function priceKey(
  balance: Pick<RawBalance, "family" | "chainId" | "asset">,
): string {
  return `${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
}

/**
 * Bounded-parallel fan-out preserving input order. Independent provider
 * calls run concurrently instead of serially; the limit keeps one
 * registration from hammering an API with hundreds of in-flight requests.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/**
 * Quote every balance. Batching providers resolve in a handful of grouped
 * calls; the rest fan out with bounded parallelism. Either way the caller
 * gets one map lookup per asset instead of N sequential round trips.
 */
export async function quoteAll(
  pricing: PricingProvider,
  balances: readonly RawBalance[],
  concurrency = 8,
): Promise<Map<string, PriceQuote | null>> {
  if (pricing.quoteMany) return pricing.quoteMany(balances);
  const out = new Map<string, PriceQuote | null>();
  const results = await mapLimit(balances, concurrency, (b) => pricing.quote(b));
  balances.forEach((b, i) => out.set(priceKey(b), results[i] ?? null));
  return out;
}

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

interface SimplePriceResponse {
  [id: string]: { usd?: number };
}

interface TokenPriceResponse {
  [address: string]: { usd?: number };
}

function usdToMicro(usd: number): bigint {
  if (!Number.isFinite(usd) || usd <= 0) return 0n;
  return BigInt(Math.round(usd * Number(VALUE_SCALE)));
}

/** Dollar-range assets are treated as par and capped at $1.00. */
export function isParStable(priceMicroUsd: bigint): boolean {
  return (
    priceMicroUsd >= VALUE_SCALE - PAR_STABLE_BAND_MICRO &&
    priceMicroUsd <= VALUE_SCALE + PAR_STABLE_BAND_MICRO
  );
}

function capAtPar(quote: PriceQuote): PriceQuote {
  if (!isParStable(quote.priceMicroUsd)) return quote;
  return { priceMicroUsd: VALUE_SCALE, derived: true };
}

/** Split an array into bounded pieces so batched request URLs stay small. */
function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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
export class CoinGeckoPricing implements PricingProvider {
  private readonly cache = new Map<string, { at: number; quote: PriceQuote | null }>();
  private readonly ttlMs: number;
  private readonly headers: Record<string, string>;
  private readonly fallback: PricingProvider | null;
  private readonly chains: readonly ChainConfig[];

  constructor(options: {
    apiKey?: string;
    ttlMs?: number;
    fallback?: PricingProvider;
    /** Include devnet chains; never enable where testnet value matters. */
    devChains?: boolean;
  } = {}) {
    this.ttlMs = options.ttlMs ?? 120_000;
    this.headers = options.apiKey
      ? { "x-cg-demo-api-key": options.apiKey }
      : {};
    this.fallback = options.fallback ?? null;
    this.chains = activeChains(options.devChains ?? false);
  }

  async quote(balance: RawBalance): Promise<PriceQuote | null> {
    return (await this.quoteMany([balance])).get(priceKey(balance)) ?? null;
  }

  async quoteMany(balances: readonly RawBalance[]): Promise<Map<string, PriceQuote | null>> {
    const out = new Map<string, PriceQuote | null>();
    const now = Date.now();
    const pending: RawBalance[] = [];
    const seen = new Set<string>();
    for (const b of balances) {
      const key = priceKey(b);
      if (out.has(key)) continue;
      const cached = this.cache.get(key);
      if (cached && now - cached.at < this.ttlMs) {
        out.set(key, cached.quote);
        continue;
      }
      out.set(key, null);
      if (!seen.has(key)) {
        seen.add(key);
        pending.push(b);
      }
    }
    if (pending.length === 0) return out;
    await this.fetchBatches(pending, out);
    // Whatever CoinGecko could not price walks the fallback chain per
    // asset, sequential per asset exactly as before, concurrent across
    // assets. Every outcome — including total misses — is cached, so a
    // wallet full of unlisted tokens costs provider calls once per TTL.
    const missed = pending.filter((b) => out.get(priceKey(b)) == null);
    await mapLimit(missed, 8, async (b) => {
      const key = priceKey(b);
      const raw = this.fallback ? await this.fallback.quote(b) : null;
      // The par cap applies to whichever provider produced the quote, so a DEX
      // fallback cannot bypass it. Native assets are never par-capped.
      const quote = raw && b.asset !== "native" ? capAtPar(raw) : raw;
      out.set(key, quote);
      this.cache.set(key, { at: Date.now(), quote });
    });
    return out;
  }

  /** One grouped call per platform plus one for natives; chunk failures fall
   * back to the original per-asset calls, preserving their exact semantics
   * (native failures throw, token failures flow to the fallback chain). */
  private async fetchBatches(
    pending: RawBalance[],
    out: Map<string, PriceQuote | null>,
  ): Promise<void> {
    const natives: RawBalance[] = [];
    const evmByPlatform = new Map<string, RawBalance[]>();
    const solana: RawBalance[] = [];
    for (const b of pending) {
      if (b.asset === "native") {
        natives.push(b);
        continue;
      }
      if (b.family === "solana") {
        solana.push(b);
        continue;
      }
      const chain = this.chains.find(
        (c) => c.chainId === b.chainId && c.family === "evm",
      );
      const platform = chain?.coingeckoPlatform;
      if (!platform) continue;
      const group = evmByPlatform.get(platform) ?? [];
      group.push(b);
      evmByPlatform.set(platform, group);
    }
    if (natives.length > 0) await this.fetchNativeBatch(natives, out);
    for (const [platform, group] of evmByPlatform) {
      await this.fetchTokenBatch(platform, group, false, out);
    }
    if (solana.length > 0) await this.fetchTokenBatch("solana", solana, true, out);
  }

  private async fetchNativeBatch(
    group: RawBalance[],
    out: Map<string, PriceQuote | null>,
  ): Promise<void> {
    const idOf = (b: RawBalance): string | null => {
      const chain = this.chains.find(
        (c) => c.chainId === b.chainId && c.family === b.family,
      );
      return chain?.nativePriceId ?? null;
    };
    const entries = group
      .map((b) => ({ b, id: idOf(b) }))
      .filter((e): e is { b: RawBalance; id: string } => e.id !== null);
    const ids = [...new Set(entries.map((e) => e.id))];
    for (const chunk of chunks(ids, 50)) {
      const data = await getJson<SimplePriceResponse>(
        `${COINGECKO_BASE}/simple/price?ids=${chunk.map(encodeURIComponent).join(",")}&vs_currencies=usd`,
        this.headers,
      ).catch(() => null);
      if (!data) {
        // Batched fetch failed: original per-asset semantics for this chunk.
        for (const id of chunk) {
          for (const e of entries.filter((x) => x.id === id)) {
            const quote = await this.nativeQuote(e.b);
            if (quote) {
              out.set(priceKey(e.b), quote);
              this.cache.set(priceKey(e.b), { at: Date.now(), quote });
            }
          }
        }
        continue;
      }
      for (const e of entries.filter((x) => chunk.includes(x.id))) {
        const usd = data[e.id]?.usd;
        if (usd === undefined) continue;
        const priceMicroUsd = usdToMicro(usd);
        if (priceMicroUsd <= 0n) continue;
        const quote: PriceQuote = { priceMicroUsd, derived: false };
        out.set(priceKey(e.b), quote);
        this.cache.set(priceKey(e.b), { at: Date.now(), quote });
      }
    }
  }

  private async fetchTokenBatch(
    platform: string,
    group: RawBalance[],
    isSolana: boolean,
    out: Map<string, PriceQuote | null>,
  ): Promise<void> {
    const addrOf = (b: RawBalance): string =>
      isSolana ? b.asset : b.asset.toLowerCase();
    const unique = [...new Set(group.map(addrOf))];
    for (const chunk of chunks(unique, 50)) {
      const data = await getJson<TokenPriceResponse>(
        `${COINGECKO_BASE}/simple/token_price/${encodeURIComponent(
          platform,
        )}?contract_addresses=${chunk.map(encodeURIComponent).join(",")}&vs_currencies=usd`,
        this.headers,
      ).catch(() => null);
      if (!data) {
        // Batched fetch failed: original per-asset semantics for this chunk.
        for (const b of group.filter((x) => chunk.includes(addrOf(x)))) {
          const quote = await this.tokenQuote(b).catch(() => null);
          const finalQ = quote && b.asset !== "native" ? capAtPar(quote) : quote;
          if (finalQ) {
            out.set(priceKey(b), finalQ);
            this.cache.set(priceKey(b), { at: Date.now(), quote: finalQ });
          }
        }
        continue;
      }
      for (const b of group.filter((x) => chunk.includes(addrOf(x)))) {
        const address = addrOf(b);
        const entry = data[address] ?? data[b.asset] ?? data[address.toLowerCase()];
        const usd = entry?.usd;
        if (usd === undefined) continue;
        const priceMicroUsd = usdToMicro(usd);
        if (priceMicroUsd <= 0n) continue;
        const quote = capAtPar({ priceMicroUsd, derived: false });
        out.set(priceKey(b), quote);
        this.cache.set(priceKey(b), { at: Date.now(), quote });
      }
    }
  }

  private async nativeQuote(balance: RawBalance): Promise<PriceQuote | null> {
    const chain = this.chains.find(
      (c) => c.chainId === balance.chainId && c.family === balance.family,
    );
    const id = chain?.nativePriceId;
    if (!id) return null;
    const data = await getJson<SimplePriceResponse>(
      `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`,
      this.headers,
    );
    const usd = data[id]?.usd;
    if (usd === undefined) return null;
    const priceMicroUsd = usdToMicro(usd);
    return priceMicroUsd > 0n ? { priceMicroUsd, derived: false } : null;
  }

  private async tokenQuote(balance: RawBalance): Promise<PriceQuote | null> {
    if (balance.family === "solana") {
      const data = await getJson<TokenPriceResponse>(
        `${COINGECKO_BASE}/simple/token_price/solana?contract_addresses=${encodeURIComponent(
          balance.asset,
        )}&vs_currencies=usd`,
        this.headers,
      );
      const entry = data[balance.asset] ?? data[balance.asset.toLowerCase()];
      const usd = entry?.usd;
      if (usd === undefined) return null;
      const priceMicroUsd = usdToMicro(usd);
      return priceMicroUsd > 0n ? { priceMicroUsd, derived: false } : null;
    }

    const chain = this.chains.find((c) => c.chainId === balance.chainId && c.family === "evm");
    const platform = chain?.coingeckoPlatform;
    if (!platform) return null;
    const address = balance.asset.toLowerCase();
    const data = await getJson<TokenPriceResponse>(
      `${COINGECKO_BASE}/simple/token_price/${encodeURIComponent(
        platform,
      )}?contract_addresses=${encodeURIComponent(address)}&vs_currencies=usd`,
      this.headers,
    );
    const entry = data[address] ?? data[balance.asset];
    const usd = entry?.usd;
    if (usd === undefined) return null;
    const priceMicroUsd = usdToMicro(usd);
    return priceMicroUsd > 0n ? { priceMicroUsd, derived: false } : null;
  }
}

const GECKOTERMINAL_BASE = "https://api.geckoterminal.com/api/v2";
const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex";

interface GeckoTerminalResponse {
  data?: { attributes?: { token_prices?: Record<string, string> } };
}

interface DexScreenerResponse {
  pairs?: Array<{
    chainId?: string;
    priceUsd?: string;
    liquidity?: { usd?: number };
  }>;
}

function parseUsd(value: string | number | undefined): bigint {
  if (value === undefined) return 0n;
  const usd = typeof value === "number" ? value : Number(value);
  return usdToMicro(usd);
}

/**
 * GeckoTerminal token prices by network and contract address. Covers assets
 * with live DEX pools that CoinGecko has not indexed; anything without a pool
 * returns null and the next fallback is tried.
 */
export class GeckoTerminalPricing implements PricingProvider {
  private readonly cache = new Map<string, { at: number; quote: PriceQuote | null }>();
  private readonly ttlMs: number;
  private readonly headers: Record<string, string>;
  private readonly fallback: PricingProvider | null;
  private readonly chains: readonly ChainConfig[];

  constructor(options: {
    apiKey?: string;
    ttlMs?: number;
    fallback?: PricingProvider;
    devChains?: boolean;
  } = {}) {
    this.ttlMs = options.ttlMs ?? 120_000;
    this.headers = options.apiKey ? { "x-api-key": options.apiKey } : {};
    this.fallback = options.fallback ?? null;
    this.chains = activeChains(options.devChains ?? false);
  }

  async quote(balance: RawBalance): Promise<PriceQuote | null> {
    const key = `gt:${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.quote;

    const quote =
      (balance.asset === "native" ? null : await this.fetchQuote(balance)) ??
      (this.fallback ? await this.fallback.quote(balance) : null);
    // Misses cache too: an unlisted token costs provider calls once per TTL,
    // not on every prove and recheck. The outcome is identical — a miss.
    this.cache.set(key, { at: Date.now(), quote });
    return quote;
  }

  private async fetchQuote(balance: RawBalance): Promise<PriceQuote | null> {
    const chain = this.chains.find(
      (c) => c.chainId === balance.chainId && c.family === balance.family,
    );
    const network = chain?.geckoterminalNetwork;
    if (!network) return null;
    const address =
      balance.family === "evm" ? balance.asset.toLowerCase() : balance.asset;
    const data = await getJson<GeckoTerminalResponse>(
      `${GECKOTERMINAL_BASE}/simple/networks/${encodeURIComponent(
        network,
      )}/token_price/${encodeURIComponent(address)}`,
      this.headers,
    ).catch(() => null);
    const prices = data?.data?.attributes?.token_prices;
    if (!prices) return null;
    const entry =
      prices[address] ??
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
export class DexScreenerPricing implements PricingProvider {
  private readonly cache = new Map<string, { at: number; quote: PriceQuote | null }>();
  private readonly ttlMs: number;
  private readonly chains: readonly ChainConfig[];

  constructor(options: { ttlMs?: number; devChains?: boolean } = {}) {
    this.ttlMs = options.ttlMs ?? 120_000;
    this.chains = activeChains(options.devChains ?? false);
  }

  async quote(balance: RawBalance): Promise<PriceQuote | null> {
    if (balance.asset === "native") return null;
    const key = `ds:${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.quote;

    const quote = await this.fetchQuote(balance);
    // Misses cache too: same reasoning as GeckoTerminal above.
    this.cache.set(key, { at: Date.now(), quote });
    return quote;
  }

  private async fetchQuote(balance: RawBalance): Promise<PriceQuote | null> {
    const chain = this.chains.find(
      (c) => c.chainId === balance.chainId && c.family === balance.family,
    );
    const chainId = chain?.dexscreenerChainId;
    if (!chainId) return null;
    const address =
      balance.family === "evm" ? balance.asset.toLowerCase() : balance.asset;
    const data = await getJson<DexScreenerResponse>(
      `${DEXSCREENER_BASE}/tokens/${encodeURIComponent(address)}`,
    ).catch(() => null);
    const pairs = (data?.pairs ?? []).filter(
      (pair) => pair.chainId === chainId && parseUsd(pair.priceUsd) > 0n,
    );
    if (pairs.length === 0) return null;
    const best = pairs.reduce((top, pair) =>
      (pair.liquidity?.usd ?? 0) > (top.liquidity?.usd ?? 0) ? pair : top,
    );
    return { priceMicroUsd: parseUsd(best.priceUsd), derived: false };
  }
}

/**
 * Fixed-price provider for tests and offline development. Assets use
 * `prices[assetKey]`, defaulting to the provided default price for native
 * assets. Assets with no configured price return null (skipped).
 */
export class StaticPricing implements PricingProvider {
  private readonly prices: Record<string, number>;
  private readonly defaultUsd: number;

  constructor(prices: Record<string, number>, defaultUsd = 0) {
    this.prices = prices;
    this.defaultUsd = defaultUsd;
  }

  async quote(balance: RawBalance): Promise<PriceQuote | null> {
    const key = `${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
    const usd = this.prices[key] ?? (balance.asset === "native" ? this.defaultUsd : 0);
    const priceMicroUsd = usdToMicro(usd);
    if (priceMicroUsd <= 0n) return null;
    const quote: PriceQuote = { priceMicroUsd, derived: false };
    return balance.asset === "native" ? quote : capAtPar(quote);
  }
}

export function categoryForPrice(
  priceMicroUsd: bigint,
): "stable" | "majors" | "altcoins" {
  if (isParStable(priceMicroUsd)) return "stable";
  if (priceMicroUsd >= MAJORS_PRICE_FLOOR_MICRO) return "majors";
  return "altcoins";
}