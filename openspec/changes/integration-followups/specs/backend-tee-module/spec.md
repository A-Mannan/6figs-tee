# Spec Delta

## Purpose

Keep the blob contract literal under add-only membership: the backend stores
and replaces ciphertext, never parses it, and refuses removals.

## MODIFIED Requirements

### Requirement: Escrow blob is opaque and replaceable

The system SHALL store the escrow blob as ciphertext without parsing it, and
SHALL replace it atomically with the bindings on every successful addition,
using the enclave-produced merged blob.

#### Scenario: Wallet added
- **WHEN** an addition persists
- **THEN** the stored blob describes the merged wallet set, remains ciphertext to the backend, and the bindings are replaced in the same transaction

#### Scenario: Wallet removed
- **WHEN** a result removes a wallet
- **THEN** the backend rejects it, the stored blob is unchanged, and no binding is deleted