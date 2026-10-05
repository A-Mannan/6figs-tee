# Spec Delta

## Purpose

Keep the full-set challenge where the signer can actually see the set, and give
additions a compact challenge that names the account the wallet is joining.

## MODIFIED Requirements

### Requirement: Challenge lists the wallet set

The system SHALL include every wallet address of the authorized set, in sorted
order, in the ownership challenge wallets sign when establishing an account or
when re-proving a full set, and the enclave SHALL reject signatures over any
other message.

#### Scenario: Multi-wallet registration
- **WHEN** a challenge is built for an establishment or full re-prove
- **THEN** the message body lists each member address and the enclave rejects signatures over any other message

## ADDED Requirements

### Requirement: Addition challenge is per wallet

The system SHALL present each added wallet a compact challenge that binds the
account's identity pseudonym, that wallet's address, the request nonce, and the
issue time, and SHALL NOT list the existing wallets.

#### Scenario: Adding a wallet
- **WHEN** a wallet is added to an existing account
- **THEN** only that wallet signs a message naming the account pseudonym and the wallet itself

#### Scenario: Addition message reuse
- **WHEN** an addition signature is presented for another nonce, timestamp, account, or wallet
- **THEN** the enclave rejects it