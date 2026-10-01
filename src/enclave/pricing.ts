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

/**
 * CoinGecko-backed pricing. Native assets are priced via /simple/price by id;
 * ERC-20/SPL tokens via /simple/token_price/{platform} by contract address.
 * There is no token allowlist: every discovered asset is quoted, and any asset
 * the API cannot price is skipped rather than valued at a guess.
 * Requests are cached per instance for a short TTL to stay within rate limits.
 */
export class CoinGeckoPricing implements PricingProvider {
  private readonly cache = new Map<string, { at: number; quote: PriceQuote }>();
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
    const key = `${balance.family}:${balance.chainId}:${balance.asset.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.quote;

    const quote =
      (await this.fetchQuote(balance)) ??
      (this.fallback ? await this.fallback.quote(balance) : null);
    if (quote) this.cache.set(key, { at: Date.now(), quote });
    return quote;
  }

  private async fetchQuote(balance: RawBalance): Promise<PriceQuote | null> {
    if (balance.asset === "native") return this.nativeQuote(balance);
    const quote = await this.tokenQuote(balance).catch(() => null);
    return quote ? capAtPar(quote) : null;
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