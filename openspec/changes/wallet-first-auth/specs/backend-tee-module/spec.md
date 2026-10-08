# Spec Delta

## REMOVED Requirements

### Requirement: Single-use session nonces

**Reason**: Extended to cover sessionless login and identify; replaced by the
added requirement below.
**Migration**: Authenticated registration and recheck keep pre-issued
single-use nonces; sessionless flows claim the attestation nonce atomically at
submit.

## ADDED Requirements

### Requirement: Single-use nonces for registration and sessionless login

The system SHALL issue a random nonce per authenticated session for
registration and recheck, store it server-side with a short TTL, and consume
(delete) it on verification. Sessionless wallet login and identify SHALL claim
the attestation's nonce atomically at submit (first submitter wins) and SHALL
reject proofs whose attested creation time is older than the replay window.

#### Scenario: Fresh registration handshake
- **WHEN** an authenticated user requests a registration nonce
- **THEN** they receive a nonce usable exactly once within its TTL

#### Scenario: Replayed nonce
- **WHEN** an already-consumed or expired nonce is submitted with a result
- **THEN** verification is rejected before any attestation work

#### Scenario: Sessionless replay
- **WHEN** a sessionless login or identify proof is submitted twice
- **THEN** the second submission is rejected and no session or recovery token is issued

#### Scenario: Stale sessionless proof
- **WHEN** a sessionless proof's attested creation time is older than the replay window
- **THEN** it is rejected before any account resolution

### Requirement: Sessionless login and identify

The system SHALL expose sessionless endpoints that verify an establish proof
with the tee verifier, resolve the owner from stored nullifier bindings, and
either issue a session (login) or a single-use recovery token (identify); a
wallet set spanning identities SHALL be rejected.

#### Scenario: Enrolled subset
- **WHEN** the proven set is a strict subset of one active identity
- **THEN** a session is issued for its owner without modifying the stored set

#### Scenario: Fresh set
- **WHEN** the proven set has no bindings
- **THEN** a new account is created and a session issued

#### Scenario: Identify reveals the username
- **WHEN** every proven wallet is enrolled and belongs to one identity
- **THEN** the username and a single-use recovery token are returned

#### Scenario: Mixed ownership
- **WHEN** the proven wallets resolve to more than one identity
- **THEN** the request is rejected and nothing is issued