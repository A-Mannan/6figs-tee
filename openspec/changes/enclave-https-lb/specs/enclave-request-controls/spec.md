# Spec Delta

## MODIFIED Requirements

### Requirement: Per-client registration rate limit

The system SHALL reject registration requests that exceed a fixed per-client rate with an HTTP 429 JSON error. The client identity SHALL be the socket peer address, unless trusted-proxy mode is enabled, in which case the system SHALL use the client address the load balancer appended to `X-Forwarded-For` and SHALL ignore any client-supplied values preceding it.

#### Scenario: Burst over the limit
- **WHEN** a client sends more registration requests than the per-minute allowance
- **THEN** the excess requests receive a 429 response and no provider calls are made for them

#### Scenario: Trusted proxy enabled
- **WHEN** trusted-proxy mode is enabled and a request arrives with `X-Forwarded-For: <supplied>,<client-ip>,<load-balancer-ip>`
- **THEN** the rate-limit key is `<client-ip>` and rotating `<supplied>` values does not admit additional requests

#### Scenario: Trusted proxy header absent or malformed
- **WHEN** trusted-proxy mode is enabled and `X-Forwarded-For` is missing or contains no valid client address
- **THEN** the rate-limit key falls back to the socket peer address

### Requirement: No wildcard CORS by default

The system SHALL only send cross-origin headers when an allowed origin is explicitly configured, and SHALL NOT fall back to a wildcard. An explicit value of `*` SHALL emit a wildcard origin for testing.

#### Scenario: Unconfigured origin
- **WHEN** no allowed origin is configured
- **THEN** responses carry no `access-control-allow-origin` header

#### Scenario: Explicit wildcard
- **WHEN** the allowed origin is configured as `*`
- **THEN** responses carry `access-control-allow-origin: *`