# Spec Delta

## Purpose

Remove the last store of readable addresses from the backend: drop
`Wallet.addressEnc`, delete every legacy read and write, and stop live balance
eligibility that depends on decoding it.

## ADDED Requirements

### Requirement: No readable address column

The backend schema SHALL NOT contain any column that stores a wallet address in
plaintext or reversible encoding; wallet rows keep only a one-way hash, chain
family, and display label.

#### Scenario: Schema audit
- **WHEN** the schema and migrations are inspected
- **THEN** no address or reversible address column exists

#### Scenario: Wallet creation
- **WHEN** a wallet is linked by any login path
- **THEN** only the address hash, chain, and label are written

### Requirement: Legacy balance eligibility is removed

The system SHALL NOT compute eligibility from live balance reads of stored
addresses; wallet-only accounts authenticate but receive no balance-derived
tier, while tee-verified accounts keep their attested record.

#### Scenario: Legacy account reads eligibility
- **WHEN** a wallet-only account without a tee identity reads eligibility
- **THEN** no live balance read runs and no tier is derived from stored addresses

#### Scenario: Tee account reads eligibility
- **WHEN** a tee-verified account reads eligibility
- **THEN** the stored attested tier is served as before

### Requirement: Wallet listings carry no address

Profile and wallet listings SHALL expose wallet family and label only, never an
address or a reversible encoding of one.

#### Scenario: Profile wallet list
- **WHEN** a user opens their profile
- **THEN** wallets are rendered from labels and families with no address value in the response

### Requirement: Wallet-signature login survives without the address column

Legacy wallet login SHALL continue to verify the signed nonce against the
address hash and SHALL NOT require the dropped column.

#### Scenario: Legacy login after migration
- **WHEN** an existing wallet-only user signs the login challenge after the migration
- **THEN** the session is issued without reading a stored address