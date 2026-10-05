# threshold-removal Specification

## Purpose
Let a user drop a wallet they still hold or have lost: every kept wallet signs
one compact removal challenge, the lost wallet signs nothing, and the attested
enclave prunes it from the escrowed set.

## Requirements

### Requirement: Removal mode with escrow state

The enclave SHALL accept a `remove` registration mode that carries the stored
escrow blob, the claimed base identity, the wallets to remove, and the kept
wallets with signatures; it SHALL decrypt the blob, refuse a recomputed
identity that differs from the claim, and refuse without a persistent escrow
key.

#### Scenario: Valid removal
- **WHEN** a removal arrives with the stored blob and a matching base identity
- **THEN** the enclave computes kept = stored − removed and produces the new set

#### Scenario: Swapped blob
- **WHEN** the blob recomputes to a different identity than claimed
- **THEN** the enclave refuses to produce a result

#### Scenario: No escrow material
- **WHEN** the enclave has no persistent escrow key
- **THEN** removal is refused explicitly

### Requirement: Kept wallets authorize the removal

Every kept wallet SHALL sign one removal challenge naming the account
pseudonym and the removed wallet(s), and the removed wallet(s) SHALL NOT be
required to sign. A kept wallet missing a signature, an unknown removed
wallet, or a request that leaves no wallet SHALL be rejected.

#### Scenario: Lost wallet
- **WHEN** the removed wallet is lost and every kept wallet signs
- **THEN** the removal proceeds without the lost wallet's key

#### Scenario: Missing kept signature
- **WHEN** a kept wallet has no valid signature
- **THEN** the enclave rejects the request

#### Scenario: Removing every wallet
- **WHEN** the requested removal would leave no wallet
- **THEN** the request is rejected

### Requirement: Signed result binds the removal

A removal result SHALL carry the previous identity nullifier, the removed
wallet nullifiers, and a fresh escrow blob for the kept set, and the verifier
SHALL accept those fields only as a complete, non-overlapping triple.

#### Scenario: Verifier shape
- **WHEN** a result carries a partial removal triple or removes a wallet that remains enrolled
- **THEN** verification fails

#### Scenario: Backend equality check
- **WHEN** the backend accepts a removal
- **THEN** the stored set equals kept ∪ removed, the previous identity belongs to the session user, and identity, bindings, and blob are replaced in one transaction

### Requirement: Additions are unchanged

The enclave SHALL keep the one-signature addition flow exactly as shipped: only
the added wallets sign, and kept wallets are neither reconnected nor re-signed.

#### Scenario: Add after removal
- **WHEN** a wallet is added after a threshold removal
- **THEN** only the new wallet signs the addition challenge
