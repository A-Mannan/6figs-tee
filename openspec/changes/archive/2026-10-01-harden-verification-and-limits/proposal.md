# Proposal

## Why

A production-grade audit of this repo (see `docs/SECURITY.md` “Attack vectors reviewed”) found fail-open attestation paths, mandatory-allowlist gaps, and unbounded per-request work in the enclave. Until these are fixed, a misconfigured policy accepts any Confidential Space workload, and a single request can burn provider quotas. Fix the cheapest, highest-severity items first (0–7 day window).

## What Changes

- PKI attestation tokens fail closed: a missing/unfetchable root rejects the token instead of checking only the leaf (`pki_root_unavailable`); leaf and root validity windows are enforced (`pki_invalid` otherwise).
- Image-digest and project allowlists become mandatory in the backend verifier and the browser client: an empty or missing list rejects real tokens (`policy_not_configured`).
- The enclave bounds work per request: per-IP rate limit (429), concurrent-registration gate (503), per-asset cap of 300, and a 30 s registration budget (`budget_exceeded` → 503).
- CORS is no longer wildcard by default; it is emitted only when `SIXFIGS_ALLOWED_ORIGIN` is set.
- Mock attestation requires the explicit `SIXFIGS_MOCK_ATTESTATION=1`; the `NODE_ENV=test` fallback is removed.
- Production deployment defaults: `confidential-space` image family, pinned container base digest, `npm ci --ignore-scripts`, `.npmrc` with `ignore-scripts`, `engines >= 22.6`.
- Documentation truth pass so no guarantee is claimed that the code does not enforce.

## Capabilities

### New Capabilities
- `attestation-verification`: fail-closed PKI root handling and mandatory allowlist policy for attestation tokens (verifier + browser client).
- `enclave-request-controls`: rate limiting, concurrency gating, per-asset caps, and registration time budgets on the enclave HTTP workload.
- `deployment-defaults`: production-safe defaults for the Confidential Space VM, container build, and dependency install.

### Modified Capabilities
- None. No baseline specs exist yet, so all behavior is captured as new requirements in the change deltas.

## Impact

- Affected code: `src/verifier/jwt.ts`, `src/verifier/index.ts`, `src/client/attestation.ts`, `src/enclave/limits.ts` (new), `src/enclave/server.ts`, `src/enclave/registration.ts`, `src/enclave/balances.ts`, `src/enclave/solana.ts`, `src/shared/constants.ts`, `Dockerfile`, `package.json`, `.npmrc` (new), `scripts/create-vm.sh`, `.env.example`, docs.
- **BREAKING**: deployments relying on empty allowlists, unset CORS origin, unset/mock attestation, or debug image families must configure policy explicitly before upgrading.
- No change to the registration protocol shape, nullifier formulas, token binding, or tier math.
