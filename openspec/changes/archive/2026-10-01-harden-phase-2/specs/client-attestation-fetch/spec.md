# Spec Delta

## Purpose

Make the browser client's retrieval of Google signing keys resilient to network faults and immune to key substitution.

## ADDED Requirements

### Requirement: Pinned JWKS bypass the network

The system SHALL verify attestation tokens against caller-provided JWKS when configured, without any network request.

#### Scenario: Offline verification with pinned keys
- **WHEN** pinned JWKS are configured and the network is unavailable
- **THEN** a token signed by a pinned key still verifies

### Requirement: Cached JWKS with bounded fetches

The system SHALL cache fetched JWKS for one hour and SHALL bound each fetch with a timeout.

#### Scenario: Repeated verification
- **WHEN** several tokens are verified within the cache window
- **THEN** the JWKS endpoints are fetched at most once

#### Scenario: Hanging endpoint
- **WHEN** Google's endpoints do not respond within the timeout
- **THEN** verification fails promptly instead of hanging
