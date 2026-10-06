# Spec Delta

## ADDED Requirements

### Requirement: Session-authorized removal endpoint

The enclave SHALL expose a removal endpoint that accepts an escrow blob, the
identity the blob must commit to, and one or more wallet nullifiers to detach,
and SHALL require no wallet signatures.

#### Scenario: Remove one wallet
- **WHEN** the backend submits the escrow blob, the stored commitment, and a wallet nullifier in the set
- **THEN** the enclave returns a signed result whose kept set omits that wallet, whose `removedWalletNullifiers` names it, and whose `previousIdentityNullifier` is the submitted commitment

#### Scenario: Wrong identity
- **WHEN** the submitted commitment does not match the decrypted set
- **THEN** the request fails with `identity_mismatch` and nothing is signed

#### Scenario: Unknown or exhaustive removal
- **WHEN** a requested wallet nullifier is not in the set, or removing would leave none enrolled
- **THEN** the request fails with `unknown_wallet` or `bad_request` respectively

### Requirement: Fresh escrow after removal

The enclosure SHALL re-encrypt the kept set to its escrow key and return it as
`nextEscrowBlob` so the backend can replace the stored blob.

#### Scenario: Blob rotated
- **WHEN** a removal succeeds
- **THEN** the result carries a `nextEscrowBlob` decryptable only by the enclave, and a subsequent recheck against it succeeds under the new commitment

### Requirement: Result shape unchanged

The removal result SHALL use the same signed body as the threshold removal
path, and the verifier and client policies SHALL require no changes.

#### Scenario: Verification unchanged
- **WHEN** the backend verifies the removal result
- **THEN** signature, attestation nonce, policy version, identity commitment, and transition fields verify with the existing code path