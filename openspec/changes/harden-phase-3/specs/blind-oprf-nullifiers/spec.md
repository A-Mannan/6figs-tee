# Spec Delta

## Purpose

Make nullifiers uncomputable by anyone — including key holders — through oblivious evaluation inside the enclave.

## ADDED Requirements

### Requirement: Blind nullifier evaluation

The system SHALL evaluate wallet nullifiers through an oblivious protocol where the client blinds inputs and the enclave applies a KMS-held key it never exposes.

#### Scenario: Registration under OPRF
- **WHEN** a wallet set registers with the OPRF scheme active
- **THEN** the resulting nullifiers match no offline computation, including by the operator

#### Scenario: Operator evaluation attempt
- **WHEN** the operator holds the KMS key reference but no blinded client input
- **THEN** they cannot produce a valid nullifier for any address
