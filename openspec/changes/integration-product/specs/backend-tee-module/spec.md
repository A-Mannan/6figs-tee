# Spec Delta

## Purpose

Verify attested wealth proofs server-side, keep only pseudonymous registry data plus opaque ciphertext, and refresh tiers on a schedule.

## ADDED Requirements

### Requirement: Single-use session nonces

The system SHALL issue a random nonce per authenticated session for registration and recheck, store it server-side with a short TTL, and consume (delete) it on verification.

#### Scenario: Fresh registration handshake
- **WHEN** an authenticated user requests a registration nonce
- **THEN** they receive a nonce usable exactly once within its TTL

#### Scenario: Replayed nonce
- **WHEN** an already-consumed or expired nonce is submitted with a result
- **THEN** verification is rejected before any attestation work

### Requirement: Attested result verification and persistence

The system SHALL verify each submitted `SignedRegistration` with the tee verifier (attestation, policy, `expectedNonce`) inside one locked transaction, then persist tier, band, top-3 assets, the escrow blob, and nullifier bindings, and link the identity to the user.

#### Scenario: Valid submission
- **WHEN** a result arrives with a fresh session nonce and a genuine attestation
- **THEN** the attested data is stored and the identity is linked to the submitting user

#### Scenario: Foreign result
- **WHEN** a genuine result produced under a different session nonce is submitted
- **THEN** it is rejected and nothing is persisted

### Requirement: Escrow blob is opaque and replaceable

The system SHALL store the escrow blob as ciphertext without parsing it, and SHALL replace it atomically with the bindings on every successful membership transition.

#### Scenario: Wallet removed
- **WHEN** a transition removes a wallet
- **THEN** the stored blob describes only the new wallet set and the old binding is gone

### Requirement: TTL re-verification

The system SHALL re-verify a verified identity through the enclave recheck endpoint when it is older than the configured TTL, serializing concurrent attempts per identity.

#### Scenario: Identity older than TTL
- **WHEN** a profile, eligibility, or room-gate read touches a verified identity past its TTL
- **THEN** one recheck runs and the stored tier, band, and top-3 assets refresh from the new signed result

### Requirement: No new address or numeric storage

The system SHALL NOT write addresses (including base64), balances, totals, percentages, or per-wallet amounts for tee-verified users, and SHALL stop live balance reads for them.

#### Scenario: Verified user write
- **WHEN** a tee registration or recheck persists
- **THEN** only nullifiers, tier data, top-3 symbols, and the opaque blob are written

#### Scenario: Eligibility read
- **WHEN** eligibility is read for a tee-verified user
- **THEN** the response contains tier data and top-3 symbols derived from the stored attested record, with no exact amounts