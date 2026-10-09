# Spec Delta

## Purpose

Resolve prices in grouped provider calls with bounded parallelism and cache
misses, without changing any pricing outcome: same endpoints, same parsing,
same fallback priority, same skip-on-miss.

## MODIFIED Requirements

### Requirement: Quotes are cached and bounded

The enclave SHALL cache each asset's resolved quote for a short TTL and SHALL
make at most a bounded number of provider calls per registration. Resolution
MAY batch assets into grouped provider calls (one native-id call, one call
per token platform group); per-asset outcomes SHALL be identical to sequential
resolution. Unresolved assets SHALL cache the miss for the same TTL.

#### Scenario: Repeat quote
- **WHEN** the same asset is quoted again within the TTL
- **THEN** the cached quote is returned without a provider call

#### Scenario: Batched resolution
- **WHEN** twenty tokens across two platforms plus natives are quoted together
- **THEN** CoinGecko is called once per platform plus once for natives, and
  each asset resolves to the same quote sequential resolution would produce

#### Scenario: Cached miss
- **WHEN** an asset no source can price is quoted again within the TTL
- **THEN** no provider call is made and the holding is skipped

#### Scenario: Batch chunk failure
- **WHEN** a grouped provider call fails
- **THEN** that chunk degrades to the original per-asset calls with identical
  outcomes, including native failures surfacing as errors
