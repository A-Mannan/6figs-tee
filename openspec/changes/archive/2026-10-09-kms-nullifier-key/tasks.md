# Tasks

> Resume here. Code first, then GCP provisioning, then the VM metadata switch.
> Mark a task `- [x]` only after its stated verification passes.

## 1. Code

- [x] 1.1 Provider: optional `wrappedNullifierKey`, one STS exchange, second
  decrypt, 32-byte check; verified by KMS tests (released, wrong length,
  decrypt failure)
- [x] 1.2 Deferred keyed scheme: constructible without a key, `pending` until
  `setKey`; verified by unit tests (pending throws, setKey clears)
- [x] 1.3 Wiring: `selectEscrowKeyProvider` and `selectNullifierScheme` read the
  new variable; `ensureEscrowLoaded` delivers the key and fails closed when a
  pending scheme is not satisfied; verified by key-manager tests
- [x] 1.4 Docs and env: `.env.example`, `docs/INTEGRATION.md`,
  `docs/DEV-ENCLAVE.md`, `docs/SECURITY.md` leak 2, dev image allowlist,
  `create-vm-dev.sh` pass-through

## 2. Provisioning

- [x] 2.1 Enable `cloudkms`/`iam`/`sts` APIs; create key ring and symmetric key
  in `us-central1`
- [x] 2.2 Encrypt the existing escrow and nullifier keys with the KMS key and
  keep the base64 ciphertext for the VM metadata
- [x] 2.3 Workload identity pool + OIDC provider (issuer
  `https://confidentialcomputing.googleapis.com`, condition on image digest and
  `dbgstat == disabled-since-boot`); bind
  `roles/cloudkms.cryptoKeyDecrypter` for the attested principal set
- [x] 2.4 Rebuild the dev image, update VM metadata (remove env keys, add the
  four `SIXFIGS_KMS_*` values, `SIXFIGS_TRUST_PROXY=1`, wildcard origin),
  remove public `:8080`, reset the VM; verified by direct `/healthz` and
  `/hello` reporting `escrowKeyProvider: kms`, `nullifierScheme: keyed-v1`
- [x] 2.5 Verify `https://tee.6figs.xyz/healthz` once the Namecheap A record
  resolves and the managed certificate is ACTIVE (verified 2026-10-09:
  `{"ok":true,"policyVersion":"6figs-tee-2026-10-e","provider":"confidential-space"}`)

## Verification commands

- `npm test`
- `npm run typecheck`