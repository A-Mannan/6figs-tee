# Spec Delta

## Purpose

Make adding a wallet a single-signature action: the new wallet consents, the
attested enclave merges it into the escrowed set, and the backend accepts only
a strict superset of the stored membership. Removal is not a product path.

## ADDED Requirements

### Requirement: Addition-only membership

The system SHALL accept wallet additions and SHALL NOT expose or persist wallet
removals: the client SDK used by the product has no removal entry point, and
the backend rejects any attestation result carrying removed wallets.

#### Scenario: Add a wallet
- **WHEN** a verified user adds a wallet
- **THEN** the wallet is added and no removal API or UI is available

#### Scenario: Result carries removals
- **WHEN** a signed result includes removed wallet nullifiers
- **THEN** the backend rejects it and persists nothing

### Requirement: New-wallet-only signatures for additions

The system SHALL require every wallet to sign when an account is first
established, and SHALL require only the added wallets to sign for an addition;
the backend SHALL authorize the transition against the stored identity and
bindings rather than trusting a client-claimed previous membership.

#### Scenario: Established account adds one wallet
- **WHEN** one new wallet signs the addition challenge
- **THEN** existing wallets are not asked to sign and the transition proceeds

#### Scenario: Foreign base identity
- **WHEN** an addition claims a previous identity that does not belong to the session user
- **THEN** the backend rejects it and persists nothing

#### Scenario: Transition drops a stored wallet
- **WHEN** the submitted new set omits a stored wallet nullifier
- **THEN** the transition is rejected

#### Scenario: Unproven wallet inserted
- **WHEN** the new set contains a wallet that is neither stored nor in the signed added set
- **THEN** the transition is rejected

### Requirement: Compact addition challenge

The addition challenge SHALL list the added wallet, the account's identity
pseudonym, the request nonce, and the issue time, and SHALL NOT list the other
wallets; the identity nullifier SHALL remain a fixed 64-hex-character
commitment regardless of set size.

#### Scenario: Challenge size is constant
- **WHEN** an addition is prepared for an account with one stored wallet and again with twenty
- **THEN** the message length does not grow with the stored set

#### Scenario: Identity commitment size
- **WHEN** any result is emitted
- **THEN** the identity nullifier is the same fixed length for every wallet count

### Requirement: Enclave-side escrow merge

The enclave SHALL decrypt the stored escrow blob with the escrow key, refuse a
blob whose recomputed identity differs from the claimed base identity, merge
the added wallets with the decrypted set, re-verify the resulting set, and
encrypt a fresh blob for the backend to store; without a persistent escrow key
it SHALL refuse the addition.

#### Scenario: Successful merge
- **WHEN** a valid addition arrives with the escrow blob and a matching base identity
- **THEN** the result contains the merged wallet nullifiers and a fresh escrow blob for the new set

#### Scenario: Swapped blob
- **WHEN** the blob's recomputed identity differs from the claimed base identity
- **THEN** the enclave refuses to produce a result

#### Scenario: Duplicate addition
- **WHEN** an added wallet is already in the decrypted set
- **THEN** the enclave rejects the request

### Requirement: Signed result binds the transition

An addition result SHALL carry the previous identity nullifier, the nullifiers
and families of the added wallets, and the fresh escrow blob, and the verifier
SHALL accept these fields only as a complete triple.

#### Scenario: Verifier shape check
- **WHEN** a result contains one or two of the addition fields
- **THEN** verification fails

#### Scenario: Backend persistence
- **WHEN** the backend accepts an addition
- **THEN** it replaces the identity, bindings, and escrow blob in one transaction and links the new identity to the same user

### Requirement: Escrow blob stays bounded

The merged escrow blob SHALL be bounded by the wallet cap, and no request or
result SHALL exceed the enclave body limit as wallet counts grow to that cap.

#### Scenario: Cap enforcement
- **WHEN** an addition would exceed the maximum wallet count
- **THEN** the enclave rejects the request

#### Scenario: Twenty-wallet blob
- **WHEN** the escrow blob holds the maximum number of wallets
- **THEN** it remains far below the request body limit and is stored as opaque text