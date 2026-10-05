# Spec Delta

## Purpose

Bring the product flow in line with add-only membership: only the added wallets
sign, and removal is not a product path.

## MODIFIED Requirements

### Requirement: Guided membership transitions

The system SHALL run wallet additions as one guided flow: prepare once, sign
only the added wallets, submit once, and require the enclave to return the
complete new set; the product SHALL NOT expose wallet removal.

#### Scenario: Wallet added
- **WHEN** a wallet is added to the account
- **THEN** only the new wallet signs, the backend receives the enclave-produced merged escrow blob, and the stored bindings transition atomically

#### Scenario: Partial signatures
- **WHEN** some added wallets have signed and others have not
- **THEN** the UI shows per-wallet progress and nothing is submitted until the added set is complete

#### Scenario: Removal requested
- **WHEN** a client attempts to remove a wallet
- **THEN** no UI path exists and the backend rejects any result carrying removals