# keyed-nullifiers Specification

## Purpose
Make wallet nullifiers uncomputable without the enclave's secret key so that a leaked registry cannot be dictionary-attacked offline.

## Requirements

### Requirement: Versioned nullifier schemes

The system SHALL compute wallet nullifiers under an explicit named scheme and SHALL advertise the active scheme in `/hello` and commit it into every signed registration result.

#### Scenario: Scheme advertisement
- **WHEN** a client fetches `/hello`
- **THEN** the response names the nullifier scheme the enclave will use

#### Scenario: Scheme commitment
- **WHEN** the enclave signs a registration result
- **THEN** the body carries the scheme name covering the exact nullifiers it contains

### Requirement: Keyed nullifiers with production fail-closed provisioning

The system SHALL derive wallet nullifiers with a keyed HMAC when a nullifier key is provisioned, and SHALL refuse to boot in production without one.

#### Scenario: Keyed derivation
- **WHEN** a nullifier key is provisioned
- **THEN** the same address always yields the same nullifier, and different keys yield different nullifiers

#### Scenario: Missing production key
- **WHEN** the enclave boots in production without a nullifier key
- **THEN** it refuses to start instead of silently using unkeyed hashes

### Requirement: Verifier enforces allowed schemes

The system SHALL reject a signed result whose nullifier scheme is not in the configured non-empty allowlist.

#### Scenario: Unlisted scheme
- **WHEN** a result arrives with a scheme outside the allowlist
- **THEN** verification fails

#### Scenario: Empty scheme list
- **WHEN** the scheme allowlist is missing or empty
- **THEN** verification fails rather than accepting any scheme
