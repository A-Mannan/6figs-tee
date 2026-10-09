# Spec Delta

## ADDED Requirements

### Requirement: KMS-released nullifier key

When a wrapped nullifier key is configured, the enclave SHALL unwrap it through the same attested Cloud KMS path as the escrow key, at boot, and SHALL derive wallet nullifiers with it without any environment copy of the key.

#### Scenario: KMS nullifier key released
- **WHEN** the enclave boots with `SIXFIGS_KMS_WRAPPED_NULLIFIER_KEY` and the KMS unwrap succeeds
- **THEN** wallet nullifiers use the keyed scheme with the released key and no nullifier key is read from the environment

#### Scenario: Configured but not released
- **WHEN** a wrapped nullifier key is configured and the KMS path does not deliver a 32-byte key
- **THEN** the enclave fails closed and does not start

#### Scenario: No KMS nullifier material
- **WHEN** no wrapped nullifier key is configured
- **THEN** the environment key, production refusal, and legacy dev scheme behave exactly as before