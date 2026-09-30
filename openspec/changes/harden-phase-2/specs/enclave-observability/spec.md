# Spec Delta

## Purpose

Give operators an audit trail of verification outcomes without ever logging private data.

## ADDED Requirements

### Requirement: Code-only verification logging

The system SHALL log verification failures and unexpected errors in the NestJS facade using error codes only, never addresses, balances, signatures, or nullifiers.

#### Scenario: Rejected submission
- **WHEN** a registration is rejected
- **THEN** exactly one warning is logged naming the verification error code and nothing identifying the user
