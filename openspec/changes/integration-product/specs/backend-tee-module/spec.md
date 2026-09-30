# Spec Delta

## Purpose

Verify attested wealth proofs server-side and persist only pseudonymous registry data linked to the logged-in user.

## ADDED Requirements

### Requirement: Single-use session nonces

The system SHALL issue a random nonce per authenticated session for registration, store it server-side with a short TTL, and consume (delete) it on verification.

#### Scenario: Fresh registration handshake
- **WHEN** an authenticated user requests a registration nonce
- **THEN** they receive a nonce usable exactly once within its TTL

#### Scenario: Replayed nonce
- **WHEN** an already-consumed or expired nonce is submitted with a result
- **THEN** verification is rejected before any attestation work

### Requirement: Attested result verification and persistence

The system SHALL verify each submitted `SignedRegistration` with the tee verifier (attestation, policy, `expectedNonce`) inside one locked transaction, then persist the tier and nullifier bindings and link the identity to the user.

#### Scenario: Valid submission
- **WHEN** a result arrives with a fresh session nonce and a genuine attestation
- **THEN** the tier is stored, nullifiers are bound, and the identity is linked to the submitting user

#### Scenario: Foreign result
- **WHEN** a genuine result produced under a different session nonce is submitted
- **THEN** it is rejected and nothing is persisted

### Requirement: No new address or balance storage

The system SHALL NOT write addresses, balances, totals, or per-wallet amounts for tee-verified users, and SHALL stop live balance reads for them.

#### Scenario: Verified user eligibility read
- **WHEN** eligibility is read for a tee-verified user
- **THEN** the response contains tier data derived only from the stored attested record
