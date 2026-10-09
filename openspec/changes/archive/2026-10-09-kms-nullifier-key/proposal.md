# Proposal

## Why

The escrow key can already be released by Cloud KMS only to the attested image.
The nullifier key — the other long-lived secret — still arrives through
`SIXFIGS_NULLIFIER_KEY` in the workload environment, so anyone with
`compute.instances.get` on the project can read it and confirm guessed
addresses against a leaked nullifier set. The OPRF alternative is dropped, but
the key does not have to sit in metadata: the existing STS/KMS unwrap can
release it too.

## What Changes

- `GcpKmsEscrowKeyProvider` accepts an optional second wrapped blob and returns
  the 32-byte nullifier key alongside the escrow key on the same attestation
  token exchange.
- `keyedNullifierScheme` can be constructed without key material; the key is
  delivered once at boot (`ensureEscrowLoaded`). Requests are only served after
  `listen()`, so a pending scheme never hashes.
- Boot fails closed when a KMS-wrapped nullifier key is configured but KMS does
  not release it.
- The environment key and the production refusal rule are unchanged when no KMS
  nullifier material is configured.

## Non-goals

- Blind OPRF evaluation; the keyed-HMAC formula and domain tag are unchanged.
- Key rotation or scheme migration for existing rows.

## Impact

- `src/shared/nullifiers.ts`, `src/enclave/key-provider.ts`,
  `src/enclave/keys.ts`, `src/enclave/server.ts`, tests.
- `.env.example`, `docs/INTEGRATION.md`, `docs/DEV-ENCLAVE.md`,
  `docs/SECURITY.md`, dev scripts.
- Operations: one more `gcloud kms encrypt`, and the same workload identity
  binding covers both blobs.