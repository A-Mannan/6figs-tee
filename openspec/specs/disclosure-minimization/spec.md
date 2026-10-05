# disclosure-minimization Specification

## Purpose
Shrink the public and stored portfolio surface to tier facts and up to three
symbols: no stablecoin share in the signed result and no per-chain allocation
percentages anywhere.

## Requirements

### Requirement: No stable share in the signed result

The enclave SHALL NOT include a stablecoin share (`stableBps`) in the signed
registration or recheck result, and the backend SHALL NOT store one; the result
carries tier, band, and `topAssets` only.

#### Scenario: Result body
- **WHEN** the enclave signs a registration or recheck
- **THEN** the canonical body contains no stable-share field

#### Scenario: Storage
- **WHEN** a verified identity is persisted
- **THEN** no stable-share column exists or is written

### Requirement: No allocation percentages at rest or in friend views

The backend SHALL NOT persist per-chain or per-category percentages, and the
friends/1v1 view SHALL carry tier only, never an allocation map.

#### Scenario: Legacy cache
- **WHEN** a cache row is written or read
- **THEN** it contains no percentage map

#### Scenario: Friend listing
- **WHEN** a VISIBLE friend is listed
- **THEN** the response carries their tier and profile fields but no
  percentages

### Requirement: Protocol version marks the trim

The policy version SHALL change when the disclosure shrinks so verifiers reject
results produced under the wider body.

#### Scenario: Old body
- **WHEN** a signed result carrying the former stable-share field is presented
- **THEN** it fails the expected-policy-version check and is not persisted
