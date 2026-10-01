# Spec Delta

## Purpose

Let the platform re-verify a tier on a schedule without ever holding readable addresses: the browser escrows addresses to the enclave, the backend stores only ciphertext, and only the enclave can decrypt.

## ADDED Requirements

### Requirement: Attested escrow key

The enclave SHALL advertise a long-lived escrow public key in `/hello` and SHALL bind it into the key attestation nonce alongside the signing and session-encryption keys.

#### Scenario: Client learns the escrow key
- **WHEN** the browser verifies `/hello`
- **THEN** the escrow key it uses for blobs is provably the one the attested enclave holds

#### Scenario: Substituted escrow key
- **WHEN** a `hello` payload carries a different escrow key
- **THEN** attestation verification fails

### Requirement: Client-side escrow blobs

The browser SHALL encrypt the wallet set to the escrow key before handing it to the backend, and the backend SHALL store the blob as opaque data it cannot decrypt.

#### Scenario: Blob stored
- **WHEN** a registration or transition succeeds
- **THEN** the backend persists the escrow blob without any readable address field

#### Scenario: Backend inspection
- **WHEN** an operator reads backend storage
- **THEN** they can recover no wallet address, only ciphertext

### Requirement: Attested recheck endpoint

The enclave SHALL expose an authenticated-by-capability recheck endpoint that decrypts an escrow blob, refuses a blob whose recomputed identity differs from the claimed identity, re-fetches balances and prices, and returns a signed, attested result bound to the caller nonce.

#### Scenario: Successful recheck
- **WHEN** the backend submits the stored blob with its identity and a fresh nonce
- **THEN** the enclave returns a fresh signed result with the same result body shape, including top-3 assets

#### Scenario: Swapped blob
- **WHEN** a blob recomputes to a different identity than claimed
- **THEN** the enclave refuses to produce a result

### Requirement: Failure closes the tier

The backend SHALL re-verify lazily when a verified identity is older than the TTL, SHALL serialize concurrent rechecks, and SHALL gate the account once the last result has expired without a successful recheck.

#### Scenario: Fresh recheck
- **WHEN** a verified identity is older than the TTL and the enclave is reachable
- **THEN** the backend refreshes tier, band, and top-3 assets from the new signed result

#### Scenario: Stale beyond expiry
- **WHEN** recheck fails and the last result has expired
- **THEN** the tier is treated as unverified and gated, never upgraded

### Requirement: Escrow key persistence

The enclave SHALL load the escrow key from provisioned persistent key material; an enclave without persistent escrow material SHALL refuse rechecks rather than return results that cannot be reproduced.

#### Scenario: Restart with no escrow key
- **WHEN** an enclave boots without escrow material and receives a recheck
- **THEN** it rejects the request explicitly