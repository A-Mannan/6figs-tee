# Spec Delta

## Purpose

Let the Next.js frontend and NestJS backend consume the audited tee protocol as a versioned dependency without vendoring or editing protocol code.

## ADDED Requirements

### Requirement: Compiled distributable with stable subpaths

The system SHALL publish `tee` as a compiled package exposing `./client`, `./verifier`, and `./shared`, while the enclave workload SHALL continue running unbuilt source.

#### Scenario: Backend import
- **WHEN** the NestJS backend imports `@sixfigs/tee/verifier`
- **THEN** it resolves to compiled output with no `.ts`-extension imports and no enclave code in the bundle

#### Scenario: Frontend import
- **WHEN** the Next.js frontend imports `@sixfigs/tee/client`
- **THEN** it resolves to browser-safe compiled output (WebCrypto, no Node-only APIs)

### Requirement: Pinned versioned consumption

The system SHALL be consumed by app repos through a pinned version reference that resolves to an exact commit, never a floating branch.

#### Scenario: Fresh install in an app repo
- **WHEN** dependencies install from the lockfile
- **THEN** the resolved tee code is byte-identical to the pinned commit
