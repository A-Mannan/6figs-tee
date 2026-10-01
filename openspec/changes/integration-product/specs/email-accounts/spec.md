# Spec Delta

## Purpose

Give users a normal web2 account (email + password) that wallets attach to, while membership changes stay wallet-authorized.

## ADDED Requirements

### Requirement: Email signup and login

The system SHALL support email + password signup and login issuing the same JWT sessions the app already uses, and SHALL store only a salted scrypt hash of the password.

#### Scenario: New account
- **WHEN** a user signs up with a unique email and a valid password
- **THEN** an account is created and a session token is issued

#### Scenario: Wrong credentials
- **WHEN** a login attempt fails or repeats beyond the rate limit
- **THEN** it is rejected without revealing whether the email exists

### Requirement: Wallets link to the logged-in account

The system SHALL attach a proven wallet set to the currently logged-in email account, never creating or switching accounts during linking.

#### Scenario: Prove after login
- **WHEN** an authenticated user completes a tee registration
- **THEN** the identity and bindings are linked to that user

#### Scenario: Wallet owned elsewhere
- **WHEN** a submitted wallet binding already belongs to another account
- **THEN** linking is rejected

### Requirement: Legacy wallet login coexists during migration

The system SHALL keep wallet-signature login working for existing accounts until they link an email, without writing plaintext addresses for tee-linked wallets.

#### Scenario: Existing user
- **WHEN** a legacy wallet-only user logs in with a signature
- **THEN** the session works and a later email link preserves the same account

### Requirement: Login needs no stored address

The system SHALL authenticate email accounts without any address column, and legacy wallet login SHALL remain the only path that references stored address hashes.

#### Scenario: Email-only session
- **WHEN** an email account has no linked wallets
- **THEN** login and profile reads work with no address present anywhere