# multi-source-pricing Specification

## Purpose
Value every discovered holding, including long-tail tokens that no oracle feed
covers, by chaining contract-address price sources: CoinGecko first, then
GeckoTerminal, then DexScreener.

## Requirements

### Requirement: Fallback price chain

The enclave SHALL quote each asset through CoinGecko first and, when CoinGecko
returns no usable price, through GeckoTerminal and then DexScreener by contract
address; the first valid quote SHALL be used and an asset no source can price
SHALL be skipped, never guessed.

#### Scenario: CoinGecko covers the asset
- **WHEN** CoinGecko returns a positive USD price
- **THEN** no fallback provider is called for that asset

#### Scenario: Long-tail token
- **WHEN** CoinGecko has no quote but GeckoTerminal or DexScreener returns a positive pool price
- **THEN** that price values the holding

#### Scenario: Unpriceable asset
- **WHEN** no provider returns a positive price
- **THEN** the holding is skipped and contributes nothing to the total

### Requirement: Chain network mapping

Each supported chain SHALL carry the provider-specific network identifiers, and
a provider SHALL skip an asset whose chain it cannot address rather than
querying another chain.

#### Scenario: Identifier mismatch
- **WHEN** a chain has no DexScreener identifier configured
- **THEN** DexScreener skips that chain and the chain's assets rely on earlier providers

### Requirement: Fallback quotes respect the par cap

A non-native quote from any provider within the par band SHALL be capped at
exactly $1.00 and classified stable, and native-asset quotes SHALL never be
par-capped.

#### Scenario: DEX stablecoin
- **WHEN** DexScreener quotes a token between $0.99 and $1.01
- **THEN** it is valued at exactly $1.00

#### Scenario: Native asset near a dollar
- **WHEN** a native asset quotes near $1.00
- **THEN** the observed price is used without the stablecoin cap

### Requirement: Quotes are cached and bounded

The enclave SHALL cache each asset's resolved quote for a short TTL and SHALL
make at most a bounded number of provider calls per registration.

#### Scenario: Repeat quote
- **WHEN** the same asset is quoted again within the TTL
- **THEN** the cached quote is returned without a provider call
