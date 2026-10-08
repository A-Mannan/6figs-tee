# Spec Delta

## REMOVED Requirements

### Requirement: Email authentication UI

**Reason**: Email authentication is removed; wallet proof is the account entry.
**Migration**: See the added "Wallet-first authentication UI" requirement.

## ADDED Requirements

### Requirement: Wallet-first authentication UI

The frontend SHALL make wallet proof the account entry: connecting and signing
one wallet SHALL create the account (fresh wallet) or sign into the account
that already owns it, and the app SHALL offer opt-in username + password
sign-in and wallet recovery instead of email.

#### Scenario: Sign up with a wallet
- **WHEN** a new user connects a wallet and approves the ownership signature
- **THEN** an account is created, a session is issued, and the profile shows the attested tier

#### Scenario: Sign in with a wallet
- **WHEN** a returning user connects any enrolled wallet and approves the signature
- **THEN** a session is issued for that account without changing the stored wallet set

#### Scenario: Username sign-in
- **WHEN** a user has set a username and password and signs in on another device
- **THEN** a session is issued with no wallet connection

#### Scenario: Wallet recovery
- **WHEN** a user forgets their username or password and signs with an enrolled wallet
- **THEN** the app reveals the username and lets them set a new password, then signs them in

### Requirement: Wallet set completion prompt

After the first wallet creates or enters the account, the frontend SHALL prompt
the user to add any remaining wallets and SHALL describe the tier as reflecting
the wallets connected so far until they finish.

#### Scenario: Fresh account
- **WHEN** a new account is created from one wallet
- **THEN** the profile offers ADD WALLET and states that the tier may rise as more wallets are added

#### Scenario: Completion
- **WHEN** the user adds each remaining wallet
- **THEN** the displayed tier updates from the newly attested set

#### Scenario: EVM and Solana wallets
- **WHEN** the user connects an EVM wallet or a Solana wallet
- **THEN** both families can be proven, signed in with, and used for recovery through the same flow