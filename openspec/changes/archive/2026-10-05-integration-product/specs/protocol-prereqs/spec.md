# Spec Delta

## Purpose

Give the tee the protocol surfaces the product needs: a session-bound registration nonce, a four-tier label mapping, dev-tier mirroring, and the top-3 asset disclosure in the signed result.

## ADDED Requirements

### Requirement: Caller-supplied registration nonce

The system SHALL accept an optional caller-supplied nonce in the tee client `prepare()` input and echo it through the request into the signed result body.

#### Scenario: Backend-issued nonce round trip
- **WHEN** `prepare()` receives a caller nonce
- **THEN** the resulting registration carries that exact nonce and the signed body echoes it back

#### Scenario: Default behavior unchanged
- **WHEN** `prepare()` receives no nonce
- **THEN** it generates a random nonce exactly as before

### Requirement: Four-tier identity mapping

The system SHALL map tee tier ids 1–4 to product labels I–IV one-to-one and SHALL expose the mapping as a shared helper used identically by frontend display and backend gating.

#### Scenario: Consistent labels
- **WHEN** either app maps a tee tier id
- **THEN** it resolves through the shared helper to the same product label (1→I, 2→II, 3→III, 4→IV)

#### Scenario: Unverified ids
- **WHEN** the tier id is 0 or outside 1–4
- **THEN** the helper returns no label and gating denies access

### Requirement: Dev tier mirroring

The system SHALL use the product's devnet tier thresholds (10/100/500/1000 USD) when dev chains are enabled, so faucet-funded dev wallets can prove real tiers through the same code path.

#### Scenario: Devnet wallet reaches a tier
- **WHEN** a devnet-enabled enclave values a wallet above a dev threshold
- **THEN** the signed result carries the corresponding tier id and floor

### Requirement: Top-3 asset disclosure

The signed result SHALL include `topAssets`, up to three sanitized asset symbols ordered by value, each holding at least 5% of the portfolio, and SHALL never include amounts.

#### Scenario: Assets disclosed
- **WHEN** a portfolio has at least one asset above the share floor
- **THEN** the result lists up to three symbols and the verifier accepts only well-formed uppercase alphanumeric symbols

#### Scenario: Dust excluded
- **WHEN** an asset holds less than the share floor
- **THEN** it never appears in `topAssets`

### Requirement: Policy version signals protocol change

The signed result SHALL carry the bumped `POLICY_VERSION` for the new body shape, and the verifier SHALL reject a result whose policy version does not match the configured expectation.

#### Scenario: Stale enclave
- **WHEN** a result carries the previous policy version
- **THEN** the backend rejects it before persistence