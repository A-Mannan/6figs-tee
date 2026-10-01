# enclave-request-controls Specification

## Purpose
Bound the work any single request or client can impose on the enclave so that provider quotas and availability cannot be exhausted by one caller.

## Requirements

### Requirement: Per-client registration rate limit

The system SHALL reject registration requests that exceed a fixed per-client rate with an HTTP 429 JSON error.

#### Scenario: Burst over the limit
- **WHEN** a client sends more registration requests than the per-minute allowance
- **THEN** the excess requests receive a 429 response and no provider calls are made for them

### Requirement: Bounded concurrent registrations

The system SHALL process only a fixed number of registrations concurrently and SHALL respond to the rest with an HTTP 503 JSON error.

#### Scenario: Saturated workload
- **WHEN** the maximum number of registrations is already running
- **THEN** a new registration request receives a 503 response immediately

### Requirement: Bounded assets per registration

The system SHALL value at most 300 assets per registration and SHALL ignore the remainder, never inflating the tier.

#### Scenario: Wallet with many tokens
- **WHEN** a wallet holds more assets than the cap
- **THEN** only the first assets within the cap are valued and the request still completes

### Requirement: Registration time budget

The system SHALL abort a registration that exceeds its time budget with a `budget_exceeded` error reported as HTTP 503.

#### Scenario: Slow providers
- **WHEN** balance discovery and pricing exceed the budget
- **THEN** the request fails with `budget_exceeded` instead of returning a partial valuation

### Requirement: No wildcard CORS by default

The system SHALL only send cross-origin headers when an allowed origin is explicitly configured, and SHALL NOT fall back to a wildcard.

#### Scenario: Unconfigured origin
- **WHEN** no allowed origin is configured
- **THEN** responses carry no `access-control-allow-origin` header
