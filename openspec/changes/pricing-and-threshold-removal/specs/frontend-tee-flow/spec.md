# Spec Delta

## Purpose

Extend the guided flow: additions stay one-signature, removals need every kept
wallet and the address (or selection) of the removed wallet.

## MODIFIED Requirements

### Requirement: Guided membership transitions

The system SHALL run additions with one signature from each new wallet and
removals with one signature from every kept wallet; the removed wallet is
identified by address (typed when lost, or connected) and SHALL NOT be asked
to sign. The product SHALL NOT allow removing the last wallet.

#### Scenario: Wallet added
- **WHEN** a wallet is added to the account
- **THEN** only the new wallet signs, the backend receives the enclave-produced merged escrow blob, and the stored bindings transition atomically

#### Scenario: Partial signatures
- **WHEN** some required wallets have signed and others have not
- **THEN** the UI shows per-wallet progress and nothing is submitted until the required set is complete

#### Scenario: Wallet removed
- **WHEN** a wallet is removed and every kept wallet signs
- **THEN** the stored bindings and escrow blob describe the kept set and the removed wallet's binding is deleted

#### Scenario: Removal requested
- **WHEN** a removal is submitted without every kept wallet's signature
- **THEN** it is rejected and nothing is persisted