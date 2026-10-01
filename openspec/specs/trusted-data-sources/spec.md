# trusted-data-sources Specification

## Purpose
Ensure balance data reaches the enclave over authenticated transport and, where operators configure redundancy, that two providers agree before a value counts.

## Requirements

### Requirement: HTTPS-only RPC endpoints

The system SHALL accept only HTTPS RPC endpoint URLs and SHALL ignore non-HTTPS endpoints.

#### Scenario: Plaintext endpoint configured
- **WHEN** an RPC environment variable holds an `http://` URL
- **THEN** that chain is skipped as if unconfigured

### Requirement: Dual-provider agreement when configured

The system SHALL, when a secondary RPC is configured for a chain, require native and token balance reads to agree within 0.1% and SHALL fail the registration on disagreement.

#### Scenario: Providers agree
- **WHEN** primary and secondary return values within tolerance
- **THEN** the primary value is used

#### Scenario: Providers disagree
- **WHEN** primary and secondary differ beyond tolerance
- **THEN** the registration fails instead of valuing the disputed balance
