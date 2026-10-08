# Spec Delta

## Purpose

Wallet-first identity: a proven wallet set is the account, signup and sign-in
resolve through attested nullifiers, any enrolled wallet can recover a
forgotten username or password, and username + password is an optional
device-free convenience.

## ADDED Requirements

### Requirement: One wallet proves the account

The system SHALL resolve a wallet proof to an account: an attested wallet
already bound to an identity signs into that account without changing the
stored wallet set, and a fresh wallet creates a new account whose tier is
computed from the attested set.

#### Scenario: Returning wallet
- **WHEN** an enrolled wallet completes the sessionless establish proof
- **THEN** a session is issued for the owning account and no binding, tier, or escrow is modified

#### Scenario: Fresh wallet
- **WHEN** a wallet with no binding completes the sessionless establish proof
- **THEN** an account is created with that wallet bound and its attested tier stored

#### Scenario: Later wallets
- **WHEN** a signed-in user proves an additional wallet
- **THEN** the enclave merges the set, re-escrows it, and the tier refreshes from the merged set

### Requirement: Recovery with any enrolled wallet

The system SHALL let a user who forgot their username or password prove any
subset of the enrolled wallet set, reveal the account's username, and issue a
single-use, expiring token that can rename the account, set a new password, and
sign the holder in; no wallet needs to be linked for recovery in advance.

#### Scenario: Forgot username or password
- **WHEN** a user proves one enrolled wallet against the identify flow
- **THEN** they receive the username and a single-use token and can set a new password and sign in

#### Scenario: Unenrolled wallet
- **WHEN** a wallet with no binding is proven against the identify flow
- **THEN** no account details are revealed and no token is issued

#### Scenario: Replayed or expired token
- **WHEN** a recovery token is consumed twice or after expiry
- **THEN** it is rejected and no credential or session changes

### Requirement: Optional username and password

The system SHALL let an authenticated user set a unique username and a
password, SHALL store only a salted scrypt hash, SHALL allow device-free
sign-in with them, SHALL rate-limit attempts, and SHALL invalidate sessions
issued before a password reset.

#### Scenario: Set credentials
- **WHEN** a signed-in user sets a username and a password meeting the policy
- **THEN** they can sign in on another device without a wallet

#### Scenario: Wrong credentials
- **WHEN** a sign-in fails or exceeds the attempt budget
- **THEN** it is rejected without revealing whether the username exists

#### Scenario: Reset invalidates sessions
- **WHEN** a password is reset through wallet recovery
- **THEN** sessions issued before the reset are rejected

### Requirement: No address reaches the backend

The system SHALL perform all wallet signature verification inside the attested
enclave and SHALL identify accounts to the backend only by keyed nullifiers;
no address, address hash, or reversible encoding SHALL reach or be stored by
the backend.

#### Scenario: Wallet flow
- **WHEN** a user signs up, signs in, adds a wallet, or recovers with a wallet
- **THEN** the backend receives only the signed result and opaque ciphertext, never an address