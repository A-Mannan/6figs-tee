# Spec Delta

## Purpose

Keep the confidential workload available across routine VM failures without weakening its security posture.

## ADDED Requirements

### Requirement: Restart on failure

The system SHALL configure the Confidential Space VM to restart on failure so a crash does not permanently end service.

#### Scenario: Crashed workload
- **WHEN** the enclave process exits unexpectedly
- **THEN** the VM restarts it automatically instead of staying stopped
