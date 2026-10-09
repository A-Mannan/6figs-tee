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
const TOKEN2 = "0x2222222222222222222222222222222222222222";
const TOKEN3 = "0x3333333333333333333333333333333333333333";

test("quoteMany batches one call per platform plus one for natives", async () => {
  const { calls, restore } = stubFetch((url) => {
    if (url.includes("simple/price?ids=")) {
      return { body: { ethereum: { usd: 3000 } } };
    }
    if (url.includes("token_price/base")) {
      return { body: { [TOKEN]: { usd: 2 }, [TOKEN2]: { usd: 3 } } };
    }
    if (url.includes("token_price/ethereum")) {
      return { body: { [TOKEN3]: { usd: 4 } } };
    }
    return undefined;
  });
  try {
    const pricing = new CoinGeckoPricing();
    const out = await pricing.quoteMany([
      token(TOKEN, 8453),
      token(TOKEN2, 8453),
      token(TOKEN3, 1),
      native(1),
    ]);
    assert.equal(out.get(`evm:8453:${TOKEN.toLowerCase()}`)?.priceMicroUsd, 2_000_000n);
    assert.equal(out.get(`evm:8453:${TOKEN2.toLowerCase()}`)?.priceMicroUsd, 3_000_000n);
    assert.equal(out.get(`evm:1:${TOKEN3.toLowerCase()}`)?.priceMicroUsd, 4_000_000n);
    assert.equal(out.get("evm:1:native")?.priceMicroUsd, 3_000_000_000n);
    const cg = calls.filter((c) => c.includes("coingecko.com"));
    assert.equal(cg.length, 3, `expected 3 batched calls, got ${cg.length}: ${cg.join(" | ")}`);
    const baseCall = cg.find((c) => c.includes("token_price/base")) ?? "";
    assert.equal(baseCall.includes(TOKEN) && baseCall.includes(TOKEN2), true);
  } finally {
    restore();
  }
});

test("batch misses still walk the fallback chain in priority order", async () => {
  const { calls, restore } = stubFetch((url) => {
    if (url.includes("coingecko.com")) return { body: { unrelated: { usd: 1 } } };
    if (url.includes("geckoterminal.com")) {
      return { body: { data: { attributes: { token_prices: { [TOKEN]: "0.5" } } } } };
    }
    return { body: { pairs: [{ chainId: "base", priceUsd: "0.7" }] } };
  });
  try {
    const pricing = new CoinGeckoPricing({
      fallback: new GeckoTerminalPricing({ fallback: new DexScreenerPricing() }),
    });
    const out = await pricing.quoteMany([token()]);
    assert.equal(out.get(`evm:8453:${TOKEN.toLowerCase()}`)?.priceMicroUsd, 500_000n);
    assert.equal(calls.some((c) => c.includes("dexscreener.com")), false);
  } finally {
    restore();
  }
});

test("a failed batch chunk degrades to per-asset calls with identical outcomes", async () => {
  const { calls, restore } = stubFetch((url) => {
    if (!url.includes("coingecko.com")) return undefined;
    if (url.includes(",")) return { status: 500, body: { error: "batch down" } };
    return { body: { [TOKEN]: { usd: 2 }, [TOKEN2]: { usd: 3 } } };
  });
  try {
    const pricing = new CoinGeckoPricing();
    const out = await pricing.quoteMany([token(TOKEN, 8453), token(TOKEN2, 8453)]);
    assert.equal(out.get(`evm:8453:${TOKEN.toLowerCase()}`)?.priceMicroUsd, 2_000_000n);
    assert.equal(out.get(`evm:8453:${TOKEN2.toLowerCase()}`)?.priceMicroUsd, 3_000_000n);
    assert.equal(calls.some((c) => c.includes(",")), true, "batch was attempted first");
  } finally {
    restore();
  }
});

test("misses are cached: repeat quotes cost no provider calls", async () => {
  const { calls, restore } = stubFetch(() => ({ status: 500, body: {} }));
  try {
    const pricing = new CoinGeckoPricing({
      fallback: new GeckoTerminalPricing({ fallback: new DexScreenerPricing() }),
    });
    assert.equal(await pricing.quote(token()), null);
    const first = calls.length;
    // Batch attempt + per-asset retry (today's failure path, verbatim) + gt + ds.
    assert.equal(first, 4, `expected batch+single+gt+ds, got ${first}`);
    assert.equal(await pricing.quote(token()), null);
    assert.equal(await pricing.quote(token()), null);
    assert.equal(calls.length, first, "no new provider calls on repeats");
  } finally {
    restore();
  }
});

test("quoteAll fans out providers without batching support", async () => {
  const { calls, restore } = stubFetch(() => undefined);
  try {
    const { quoteAll } = await import("../src/enclave/pricing.ts");
    const { StaticPricing } = await import("../src/enclave/pricing.ts");
    const pricing = new StaticPricing({ [`evm:8453:${TOKEN.toLowerCase()}`]: 2 }, 0);
    const out = await quoteAll(pricing, [token(), native(1)]);
    assert.equal(out.get(`evm:8453:${TOKEN.toLowerCase()}`)?.priceMicroUsd, 2_000_000n);
    assert.equal(out.get("evm:1:native"), null);
    assert.equal(calls.length, 0, "static pricing makes no calls");
  } finally {
    restore();
  }
});

test("mapLimit preserves order under concurrency", async () => {
  const { mapLimit } = await import("../src/enclave/pricing.ts");
  const out = await mapLimit([3, 1, 2], 2, async (n) => {
    await new Promise((r) => setTimeout(r, (4 - n) * 5));
    return n * 10;
  });
  assert.deepEqual(out, [30, 10, 20]);
});
