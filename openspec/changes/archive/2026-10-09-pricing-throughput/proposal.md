# Proposal: pricing throughput (batch + bounded parallelism + miss caching)

## Why

Every registration prices each discovered asset with its own sequential HTTP
round trip, fanning out to three providers per unlisted token. A 25-asset
wallet costs ~30 sequential provider calls; at CoinGecko free-tier limits
that is both the dominant submit latency and a standing 429 risk. The
pricing work is embarrassingly parallel and CoinGecko answers grouped
queries, so the same data costs a handful of calls.

## What changes

- **ADD** batched CoinGecko resolution: one `/simple/price` call for all
  native ids, one `/simple/token_price/{platform}` call per chain group
  (chunked at 50 addresses). Chunk failures degrade to the original
  per-asset calls, preserving their exact semantics.
- **ADD** bounded-parallel fan-out (`mapLimit`, 8 in flight) for fallback
  misses across assets; the CoinGecko → GeckoTerminal → DexScreener order
  per asset is unchanged.
- **ADD** miss caching: unresolved assets cache null for the same TTL, so a
  wallet of unlisted tokens costs provider calls once per window instead of
  on every prove and recheck.
- **MODIFY** `registration.ts` `valueBalances` only: one `quoteAll` pass
  instead of a sequential `quote` loop. Tier math, nullifiers, deadlines,
  budgets, and the signed body are untouched.

## What does not change

- Observable pricing outcomes: same endpoints, same parsing, same par cap,
  same fallback priority, same skip-on-miss. No `POLICY_VERSION` bump: the
  signed body cannot distinguish the two paths.
- Balance discovery order and the asset budget (sequential wallets/chains).
- Privacy invariants: no new stored fields, no new logs, no address-bearing
  values outside the escrow blob.

## Non-goals

- Parallel RPC balance discovery (deterministic over-cap ordering stays).
- Longer price TTLs or shared cross-instance caches.
- Racing the fallback providers against each other (order stays literal).
