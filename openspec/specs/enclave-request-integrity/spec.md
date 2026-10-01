# enclave-request-integrity Specification

## Purpose
Close the remaining request-integrity gaps: replayed envelopes, internal error leakage, and incomplete token enumeration.

## Requirements

### Requirement: Replay rejection

The system SHALL reject a registration envelope whose request nonce was already processed within the freshness window.

#### Scenario: Replayed envelope
- **WHEN** an identical envelope is submitted twice
- **THEN** the second submission is rejected and no provider calls are made for it

#### Scenario: Honest retry after overload
- **WHEN** a request was refused with 503 before its nonce was recorded
- **THEN** retrying the same envelope is still accepted

### Requirement: Safe error responses

The system SHALL return a generic message for unexpected enclave failures, never internal error text.

#### Scenario: Internal failure
- **WHEN** the enclave throws an unexpected error
- **THEN** the response is HTTP 500 with a fixed message and no implementation detail

### Requirement: Complete token enumeration

The system SHALL follow provider pagination when enumerating token holdings, bounded to protect provider quotas.

#### Scenario: Paginated holdings
- **WHEN** the provider returns holdings across pages
- **THEN** every page within the bound is enumerated before valuation
