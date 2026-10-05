# frontend-tee-flow Specification

## Purpose
Let users sign in with email, prove their tier from the browser without exposing addresses or balances, and see a clean tier + top-3 profile that refreshes itself.

## Requirements

### Requirement: Email authentication UI

The frontend SHALL provide email signup and login, keep the session token as it does today, and offer wallet connection only when a wallet action is needed.

#### Scenario: Sign in without a wallet
- **WHEN** a user signs in with email
- **THEN** the app opens their profile with no wallet prompt

#### Scenario: Existing wallet session
- **WHEN** a legacy wallet user arrives
- **THEN** the existing session flow still works and can link an email later

### Requirement: Browser prove flow with escrow

The system SHALL drive the full prove sequence (session nonce, enclave attestation check, per-wallet signature, envelope submit, result verification, backend POST with the escrow blob) from the profile page using the wallet adapter's signer.

#### Scenario: Successful prove
- **WHEN** a connected user approves every wallet signature
- **THEN** the backend stores the tier, top-3 assets, and escrow blob, and the UI shows the tier badge with no exact amounts

#### Scenario: Declined signature
- **WHEN** the user rejects any wallet signature
- **THEN** nothing is submitted, nothing is stored, and the UI reports which wallet declined

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

### Requirement: Tier and top-3 display only

The system SHALL NOT render exact totals, per-wallet balances, percentages, or progress-to-next-tier amounts for tee-verified users; it SHALL render the tier badge, the coarse band, and at most three asset symbols.

#### Scenario: Verified profile render
- **WHEN** the profile loads for a tee-verified user
- **THEN** only tier, band, top-3 symbols, and wallet labels appear — no numbers

#### Scenario: Unverified profile render
- **WHEN** the profile loads for an account without a fresh proof
- **THEN** a prove call-to-action is shown instead of numbers

### Requirement: Silent refresh

The frontend SHALL refresh tier data from the backend after a recheck without asking the user to sign, and SHALL mark stale data when the backend reports it.

#### Scenario: TTL elapsed
- **WHEN** the profile loads and the backend refreshes an expired TTL
- **THEN** the tier, band, and top-3 symbols update without any wallet prompt
