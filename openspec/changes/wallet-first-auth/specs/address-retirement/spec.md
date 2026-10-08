# Spec Delta

## REMOVED Requirements

### Requirement: Wallet-signature login survives without the address column

**Reason**: The legacy address-hash wallet login is removed; wallet
authentication resolves through attested nullifier bindings only.
**Migration**: See the added "Wallet authentication uses no stored address"
requirement.

## ADDED Requirements

### Requirement: Wallet authentication uses no stored address

The system SHALL authenticate wallets only through attested nullifier
bindings, and SHALL NOT read or write any address or address-derived hash for
authentication; the legacy address-hash wallet login and the legacy `Wallet`
table SHALL be removed.

#### Scenario: Wallet login after migration
- **WHEN** a user proves control of an enrolled wallet
- **THEN** the session is issued from the attested nullifier binding without reading or storing any address or address hash

#### Scenario: No auth address column
- **WHEN** the schema is inspected
- **THEN** no column used for authentication stores an address or an address-derived hash

#### Scenario: Legacy rows removed
- **WHEN** the migration runs
- **THEN** legacy wallet rows and their address hashes are deleted and no read path references them