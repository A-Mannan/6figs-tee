# Design: pricing throughput

## Batching

`CoinGeckoPricing.quoteMany` groups uncached balances: natives by price id,
EVM tokens by `coingeckoPlatform`, Solana tokens as one group. Each group
resolves in chunked (50) grouped calls; response entries map back per asset
with the existing lookup rules (`data[addr] ?? data[lower]`). Assets absent
from a 200 response flow to the fallback chain; a failed chunk replays the
original per-asset calls for that chunk only, so native failures still throw
and token failures still flow to fallbacks — the failure domain narrows to
the chunk, never widens.

## Concurrency

`mapLimit(items, 8, fn)` interleaves fallback misses across assets with
order-preserving results. The single-threaded interleaving keeps cache
reads/writes race-free. The limit bounds one registration's in-flight
pressure on the fallback APIs.

## Caching

All three providers cache misses as `{ quote: null }` under the existing
TTL (env-overridable via `SIXFIGS_PRICE_TTL_MS`). A miss returns the same
outcome a fresh lookup would — skip — without a provider call. Positive
entries are unchanged.

## Callers

`valueBalances` calls `quoteAll(pricing, balances)`: batching providers take
the fast path, others (StaticPricing in dev/tests) fan out with the same
concurrency cap. Deadline and budget checks still gate every asset.
