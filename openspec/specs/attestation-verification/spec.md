# attestation-verification Specification

## Purpose
Lock down how attestation tokens are validated so that any validation input that cannot be fully checked causes rejection rather than silent acceptance.

## Requirements

### Requirement: PKI tokens require a validated root

The system SHALL verify an x5c PKI attestation token only against a configured or freshly fetched Google root certificate, and SHALL reject the token when no root is available.

#### Scenario: Root unavailable
- **WHEN** a PKI token arrives and the root cannot be configured or fetched
- **THEN** verification fails with a root-unavailable error and no claims are trusted

#### Scenario: Valid chain
- **WHEN** a PKI token arrives whose leaf is signed by the pinned root and both certificates are within their validity windows
- **THEN** verification proceeds to claim checks

### Requirement: Certificate validity windows enforced

The system SHALL reject attestation certificates that are expired or not yet valid.

#### Scenario: Expired leaf
- **WHEN** a PKI token arrives with an expired leaf certificate
- **THEN** verification fails and the token is rejected

### Requirement: Allowlist policy is complete before trust

The system SHALL reject any real attestation token when the image-digest or project allowlist is missing or empty, instead of disabling that check.

#### Scenario: Empty digest list
- **WHEN** a real attestation token is verified with an empty image-digest allowlist
- **THEN** verification fails with a policy-not-configured error

#### Scenario: Empty project list
- **WHEN** a real attestation token is verified with an empty project allowlist
- **THEN** verification fails with a policy-not-configured error

#### Scenario: Configured policy enforced
- **WHEN** a real attestation token carries a digest and project present in the configured lists
- **THEN** verification continues to the remaining claim checks

### Requirement: Mock attestations require explicit opt-in

The system SHALL accept mock attestation tokens only when mock mode is explicitly enabled, and SHALL reject them in every other configuration.

#### Scenario: Mock without opt-in
- **WHEN** a mock token is submitted and mock acceptance is not enabled
- **THEN** verification fails
