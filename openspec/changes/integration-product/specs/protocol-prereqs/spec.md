# Spec Delta

## Purpose

Give the backend a session-bound registration handshake so an attested result is only accepted from the login session that produced it.

## ADDED Requirements

### Requirement: Caller-supplied registration nonce

The system SHALL accept an optional caller-supplied nonce in the tee client `prepare()` input and echo it through the request into the signed result body.

#### Scenario: Backend-issued nonce round trip
- **WHEN** `prepare()` receives a caller nonce
- **THEN** the resulting registration carries that exact nonce and the signed body echoes it back

#### Scenario: Default behavior unchanged
- **WHEN** `prepare()` receives no nonce
- **THEN** it generates a random nonce exactly as before

### Requirement: Shared tier-label mapping

The system SHALL provide a single mapping from tee tier ids to product tier labels used identically by frontend display and backend gating.

#### Scenario: Consistent labels
- **WHEN** either app maps a tee tier id
- **THEN** it resolves through the shared helper to the same product label
