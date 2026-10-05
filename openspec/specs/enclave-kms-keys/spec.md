# enclave-kms-keys Specification

## Purpose
Release the persistent escrow key only to a workload whose image the platform
has attested, so the operator who runs the enclave cannot decrypt stored
addresses either.

## Requirements

### Requirement: Pluggable escrow key provider

The enclave SHALL load the escrow private key at boot through a configured
provider and SHALL report the provider kind as `kms`, `env`, or `none`; without
a persistent key it SHALL refuse rechecks and wallet additions while still
serving fresh registrations.

#### Scenario: KMS-configured boot
- **WHEN** the enclave boots with a KMS key reference and wrapped key material
- **THEN** it unwraps the escrow key once at boot and advertises provider `kms`

#### Scenario: No persistent material
- **WHEN** no KMS reference and no environment key are configured
- **THEN** the enclave advertises provider `none` and rejects recheck and addition requests explicitly

### Requirement: KMS unwrap is authenticated by attestation

The enclave SHALL obtain a Confidential Space attestation token, exchange it at
the GCP Security Token Service for a federated access token, optionally
impersonate the configured service account, and call Cloud KMS to decrypt the
wrapped escrow key; any failure in the chain SHALL prevent boot when KMS is the
configured provider.

#### Scenario: Honest unwrap
- **WHEN** KMS is configured and every exchange step succeeds
- **THEN** the 32-byte escrow private key is loaded and the escrow public key is unchanged from the wrapped key's keypair

#### Scenario: Exchange failure
- **WHEN** the STS exchange, impersonation, or KMS call fails
- **THEN** the enclave does not start and no recheck can run against an unusable key

### Requirement: Provider is advertised and verifiable

The `/hello` payload SHALL carry the escrow key provider kind and the KMS key
resource when applicable, while the key attestation nonce continues to bind the
escrow public key.

#### Scenario: Provider visible to clients
- **WHEN** a client verifies `/hello`
- **THEN** it can require provider `kms` under its policy and reject an enclave holding an environment or absent escrow key

### Requirement: Production refuses environment escrow keys

The enclave SHALL refuse to boot in production when the escrow key comes from
the environment, unless the operator sets the documented explicit override.

#### Scenario: Production with env key
- **WHEN** the enclave boots in production with only `SIXFIGS_ESCROW_KEY`
- **THEN** it fails closed instead of accepting a key the operator can read

#### Scenario: Explicit dev override
- **WHEN** the operator sets the documented override
- **THEN** the environment provider is allowed, for dev and staging only
