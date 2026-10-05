import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CoinGeckoPricing,
  DexScreenerPricing,
  GeckoTerminalPricing,
  isParStable,
} from "../src/enclave/pricing.ts";
import { VALUE_SCALE } from "../src/shared/constants.ts";
import type { RawBalance } from "../src/enclave/balances.ts";

const TOKEN = "0x1111111111111111111111111111111111111111";

function token(asset = TOKEN, chainId = 8453): RawBalance {
  return {
    chainId,
    family: "evm",
    asset,
    symbol: "LONG",
    decimals: 18,
    balanceRaw: 10n ** 18n,
  };
}

function native(chainId = 1): RawBalance {
  return {
    chainId,
    family: "evm",
    asset: "native",
    symbol: "ETH",
    decimals: 18,
    balanceRaw: 10n ** 18n,
  };
}

function stubFetch(
  handler: (url: string) => { status?: number; body: unknown } | undefined,
): { calls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: unknown) => {
    const href = String(url);
    calls.push(href);
    const hit = handler(href);
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("GeckoTerminal quotes a token by network and address", async () => {
  const { calls, restore } = stubFetch((url) =>
    url.includes("geckoterminal.com") && url.includes("/base/token_price/")
      ? {
          body: {
            data: {
              attributes: { token_prices: { [TOKEN]: "0.0042" } },
            },
          },
        }
      : undefined,
  );
  try {
    const provider = new GeckoTerminalPricing();
    const quote = await provider.quote(token());
    assert.equal(quote?.priceMicroUsd, 4200n);
    assert.equal(calls.some((c) => c.includes("/networks/base/token_price/")), true);
  } finally {
    restore();
  }
});

test("GeckoTerminal skips unmapped chains and native assets", async () => {
  const { calls, restore } = stubFetch(() => undefined);
  try {
    const provider = new GeckoTerminalPricing();
    assert.equal(await provider.quote(token(TOKEN, 11155111)), null);
    assert.equal(await provider.quote(native()), null);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("DexScreener picks the deepest pair on the matching chain", async () => {
  const { restore } = stubFetch((url) =>
    url.includes("dexscreener.com")
      ? {
          body: {
            pairs: [
              { chainId: "base", priceUsd: "0.0001", liquidity: { usd: 5_000 } },
              { chainId: "base", priceUsd: "0.0002", liquidity: { usd: 90_000 } },
              { chainId: "ethereum", priceUsd: "9.99", liquidity: { usd: 1_000_000 } },
            ],
          },
        }
      : undefined,
  );
  try {
    const quote = await new DexScreenerPricing().quote(token());
    assert.equal(quote?.priceMicroUsd, 200n);
  } finally {
    restore();
  }
});

test("DexScreener returns null without a matching chain or price", async () => {
  const { restore } = stubFetch((url) =>
    url.includes("dexscreener.com")
      ? { body: { pairs: [{ chainId: "solana", priceUsd: "1.23" }] } }
      : undefined,
  );
  try {
    assert.equal(await new DexScreenerPricing().quote(token()), null);
  } finally {
    restore();
  }
});

test("the fallback chain stops at the first valid quote", async () => {
  const { calls, restore } = stubFetch((url) => {
    if (url.includes("coingecko.com")) {
      return { body: { [TOKEN]: { usd: 0 } } };
    }
    if (url.includes("geckoterminal.com")) {
      return {
        body: { data: { attributes: { token_prices: { [TOKEN]: "0.5" } } } },
      };
    }
    return { body: { pairs: [{ chainId: "base", priceUsd: "0.7" }] } };
  });
  try {
    const pricing = new CoinGeckoPricing({
      fallback: new GeckoTerminalPricing({
        fallback: new DexScreenerPricing(),
      }),
    });
    const quote = await pricing.quote(token());
    assert.equal(quote?.priceMicroUsd, 500_000n);
    assert.equal(calls.some((c) => c.includes("dexscreener.com")), false);
  } finally {
    restore();
  }
});

test("DexScreener is used when CoinGecko and GeckoTerminal miss", async () => {
  const { restore } = stubFetch((url) => {
    if (url.includes("geckoterminal.com")) {
      return { body: { data: { attributes: { token_prices: {} } } } };
    }
    return { body: { pairs: [{ chainId: "base", priceUsd: "1.004" }] } };
  });
  try {
    const pricing = new CoinGeckoPricing({
      fallback: new GeckoTerminalPricing({
        fallback: new DexScreenerPricing(),
      }),
    });
    const quote = await pricing.quote(token());
    assert.equal(quote?.priceMicroUsd, VALUE_SCALE);
    assert.equal(quote?.derived, true, "fallback quote is par-capped");
  } finally {
    restore();
  }
});

test("native assets are never par-capped", async () => {
  const { restore } = stubFetch((url) =>
    url.includes("coingecko.com")
      ? { body: { ethereum: { usd: 1.005 } } }
      : undefined,
  );
  try {
    const quote = await new CoinGeckoPricing().quote(native());
    assert.equal(quote?.priceMicroUsd, 1_005_000n);
    assert.equal(isParStable(quote!.priceMicroUsd), true);
    assert.equal(quote?.derived, false);
  } finally {
    restore();
  }
});

test("unpriceable assets are skipped rather than guessed", async () => {
  const { restore } = stubFetch(() => ({ status: 500, body: { error: "down" } }));
  try {
    const pricing = new CoinGeckoPricing({
      fallback: new GeckoTerminalPricing({
        fallback: new DexScreenerPricing(),
      }),
    });
    assert.equal(await pricing.quote(token()), null);
  } finally {
    restore();
  }
});