# Spec Delta

## Purpose

Let users prove their tier from the browser without ever exposing addresses or balances to the platform.

## ADDED Requirements

### Requirement: Browser prove flow

The system SHALL drive the full prove sequence (fetch nonce, verify enclave attestation, sign challenge per wallet, submit envelope, verify result, POST to backend) from the profile page using the wallet adapter's signer.

#### Scenario: Successful prove
- **WHEN** a connected user approves every wallet signature
- **THEN** the backend stores their tier and the UI shows the new tier badge without any exact amounts

#### Scenario: Declined signature
- **WHEN** the user rejects any wallet signature
- **THEN** nothing is submitted and the UI reports which wallet declined

### Requirement: Re-proof on wallet membership change

The system SHALL require a fresh prove covering the complete wallet set after any wallet is added or removed.

#### Scenario: Wallet added
- **WHEN** a wallet is added to the account
- **THEN** the next prove includes all wallets and the backend transitions the stored bindings

### Requirement: Tier-only display

The system SHALL NOT render exact totals, per-wallet balances, or progress-to-next-tier amounts for tee-verified users.

#### Scenario: Verified profile render
- **WHEN** the profile loads for a tee-verified user
- **THEN** only the tier badge and coarse band are shown
