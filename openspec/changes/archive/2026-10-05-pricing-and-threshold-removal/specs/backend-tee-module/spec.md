# Spec Delta

## Purpose

Accept threshold removals at the trust boundary with exact-set checks, while
keeping additions and establishment unchanged.

## MODIFIED Requirements

### Requirement: Escrow blob is opaque and replaceable

The system SHALL store the escrow blob as ciphertext without parsing it, and
SHALL replace it atomically with the bindings on every successful addition or
removal, using the enclave-produced blob for the resulting set.

#### Scenario: Wallet added
- **WHEN** an addition persists
- **THEN** the stored blob describes the merged wallet set, remains ciphertext to the backend, and the bindings are replaced in the same transaction

#### Scenario: Wallet removed
- **WHEN** a removal persists
- **THEN** the stored set equals kept ∪ removed, the removed wallet's binding is deleted, the stored blob describes the kept set, and all three changes run in one transaction

#### Scenario: Removal without threshold proof
- **WHEN** a removal result's removed set does not match the stored set minus the kept set, or the previous identity does not belong to the session user
- **THEN** the backend rejects it and persists nothing