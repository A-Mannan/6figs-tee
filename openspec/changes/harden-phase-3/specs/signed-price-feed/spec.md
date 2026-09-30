# Spec Delta

## Purpose

Replace blind trust in a price API with cryptographically verified price data checked inside the enclave.

## ADDED Requirements

### Requirement: Signed price verification

The system SHALL accept a price only with a valid feed signature over the asset, price, and timestamp, checked inside the enclave.

#### Scenario: Valid signed quote
- **WHEN** a feed payload verifies for the asset at a fresh timestamp
- **THEN** the price is used for valuation

#### Scenario: Stale or unsigned quote
- **WHEN** a quote is stale beyond policy or lacks a valid signature
- **THEN** the asset is skipped with an explicit `price_stale` outcome, never valued silently
