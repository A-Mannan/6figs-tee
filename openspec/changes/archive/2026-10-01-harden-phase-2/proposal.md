# Proposal

## Why

The first hardening pass closed the fail-open attestation paths and bounded enclave work. The remaining audit findings still weaken the core promises: wallet nullifiers are computable offline by anyone (deanonymization on DB leak), RPC and price inputs are single-sourced and unverified, store transitions are not atomic, the signed challenge hides the wallet set from the signer, and several operational gaps (observability, replay cache, error leakage, deployment availability) are open. This change implements the rest of the audit roadmap.

## What Changes

- Keyed wallet nullifiers: a `NullifierScheme` abstraction with a legacy SHA-256 scheme and a keyed HMAC scheme; the active scheme is advertised in `/hello` and committed into the signed result; the verifier enforces an allowlist of schemes; production boot without a nullifier key fails closed.
- Trusted data sources: RPC URLs must be HTTPS; when a secondary RPC is configured, native and token balance reads must agree within 0.1% or the registration fails.
- Transactional registration: a `runTransaction` store primitive; the service executes read-check-mutate inside it; the in-memory store serializes with a mutex; Postgres guidance rewritten around a single locked transaction.
- Membership-visible challenges: the ownership challenge lists every wallet in the set being authorized.
- Browser client JWKS handling: pinned JWKS support, 1 h cache, 10 s fetch timeout.
- Observability: the NestJS facade's logger is wired and records verification outcomes by code only.
- Request integrity: enclave-side replay cache for request nonces (`replay_detected`), generic 500 messages, paginated token enumeration.
- Hygiene and availability: dead exports removed, stale comments fixed, VM restart policy `Always`.
- **BREAKING**: protocol bump to `6figs-tee-2026-09-d` (new challenge format, new `nullifierScheme` result field); verifier policy gains `allowedNullifierSchemes`; client `prepare` takes the nullifier scheme; store interface gains `runTransaction`.

## Capabilities

### New Capabilities
- `keyed-nullifiers`: versioned nullifier schemes with production fail-closed key provisioning.
- `trusted-data-sources`: HTTPS-only RPC endpoints with optional dual-provider agreement.
- `transactional-registration`: atomic read-check-mutate registration persistence.
- `membership-challenge`: human-readable wallet set in the signed ownership challenge.
- `client-attestation-fetch`: pinned, cached, time-bounded JWKS retrieval in the browser client.
- `enclave-observability`: code-only verification outcome logging in the NestJS facade.
- `enclave-request-integrity`: replay rejection, safe error responses, and complete token enumeration.
- `deployment-availability`: restart-on-failure VM policy.

### Modified Capabilities
- None. No baseline specs exist yet, so all behavior is captured as new requirements in the change deltas.

## Impact

- Affected code: `src/shared/nullifiers.ts`, `src/shared/constants.ts`, `src/shared/types.ts`, `src/enclave/registration.ts`, `src/enclave/ownership.ts`, `src/enclave/keys.ts`, `src/enclave/server.ts`, `src/enclave/balances.ts`, `src/enclave/solana.ts`, `src/enclave/limits.ts`, `src/client/register.ts`, `src/client/attestation.ts`, `src/verifier/index.ts`, `src/verifier/service.ts`, `src/verifier/store.ts`, `src/verifier/nestjs.ts`, `scripts/create-vm.sh`, `test/*`, docs.
- Operators must provision `SIXFIGS_NULLIFIER_KEY` for production, configure `allowedNullifierSchemes`, and implement `runTransaction` in the SQL store.
