# Spec Delta

## Purpose

Keep proofs available and auditable when a single machine fails or is attacked.

## ADDED Requirements

### Requirement: Multi-instance operation

The system SHALL run at least two enclave instances behind a load balancer with no affinity, sharing only the nullifier store.

#### Scenario: Single instance loss
- **WHEN** one enclave VM fails
- **THEN** registrations continue on the survivors with no manual intervention

### Requirement: Verification alerting and registry audit

The system SHALL alert on verification-failure spikes and SHALL provide a write-only audit proving the registry was never read through a lookup endpoint.

#### Scenario: Failure spike
- **WHEN** rejections exceed the alert threshold
- **THEN** operators are paged with error-code breakdowns containing no identifying data
