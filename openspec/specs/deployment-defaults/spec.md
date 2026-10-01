# deployment-defaults Specification

## Purpose
Ensure every production deployment starts from the strongest configuration, with debug and mock modes requiring explicit operator action.

## Requirements

### Requirement: Production image family default

The system SHALL create the Confidential Space VM from the production image family by default, requiring an explicit override to use a debug family.

#### Scenario: Default invocation
- **WHEN** the VM creation script runs without an image family override
- **THEN** the VM is created from the production `confidential-space` family

### Requirement: Explicit mock attestation

The system SHALL enable mock attestation only when its dedicated environment flag is set, never as a side effect of the Node environment.

#### Scenario: Test environment without flag
- **WHEN** the enclave boots with `NODE_ENV=test` but without the mock flag
- **THEN** the real attestation provider is selected

### Requirement: Reproducible container build

The system SHALL build the workload image from a digest-pinned base image and SHALL install runtime dependencies from the lockfile without lifecycle scripts.

#### Scenario: Fresh build
- **WHEN** the image is built from a clean checkout on any machine
- **THEN** the dependency tree and base image are exactly those recorded in the lockfile and Dockerfile digest
