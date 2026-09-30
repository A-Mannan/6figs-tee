# Design

## Context

Baseline: wallet nullifiers are unkeyed SHA-256 (`src/shared/nullifiers.ts`); the verifier trusts single RPC/price responses; `RegistrationService.submit` performs read-check-mutate as separate store calls; the ownership challenge shows only the identity hash; the browser client fetches JWKS per verification with no pin, cache, or timeout; the NestJS facade accepts a logger it never uses; the enclave has no replay memory and echoes internal error text. See proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- Offline dictionary attacks against leaked nullifiers require the enclave key.
- Balance reads are either single-sourced and documented, or dual-sourced and agreeing.
- Concurrent submissions for one account serialize to a coherent state.
- A signer can see exactly which wallets a signature authorizes.

**Non-Goals:**
- Full OPRF with blinded evaluation (still future; keyed HMAC is the bridge).
- Signed price feeds, light clients (still future).
- Threshold transitions for lost wallets (still future).

## Decisions

- **Scheme object, not a flag.** `NullifierScheme` carries `name` plus the hash function, so client, enclave, and verifier all compute/commit/check the same version. The scheme rides in `/hello` and in the signed body; the verifier allowlists it like image digests. Alternative: parallel code paths per scheme — rejected as untestable sprawl.
- **Key provisioning via environment, fail-closed in production.** `SIXFIGS_NULLIFIER_KEY` (64 hex chars) selects the keyed scheme; absent in production, the enclave refuses to boot. Alternative: KMS client in the workload — rejected to preserve the zero-dependency rule; the KMS-backed step stays on the roadmap.
- **New wallet domain tag for keyed mode** (`6figs-wallet-v2`) so the two formulas can never collide even if a key leaks.
- **Single protocol bump to `-d`** for the challenge format and body field together, rather than two churns.
- **`runTransaction`, not store-owned logic.** The decision policy stays in `RegistrationService`; the store only provides the atomic boundary (`runTransaction`), keeping one decision site and serializable SQL implementations. In-memory uses a mutex; Postgres guidance uses one locked transaction.
- **Challenge lists wallets, not nullifiers.** Signers read addresses, not hashes; sorted `family:address` lines make replay across sets impossible because the set hash is also signed.
- **Replay cache checked after the concurrency gate** so 503 responses never burn a nonce and honest retries keep working. TTL equals the request freshness window.
- **Generic 500s, coded 400s.** Client-facing error codes stay (they name the caller's own mistake); internal detail never leaves the enclave.
- **Pagination bounded at 8 pages** plus the existing 300-asset cap, so enumeration is complete for realistic wallets and bounded for dust collectors.

## Risks / Trade-offs

- [Key rotation invalidates all nullifiers] → Mitigation: scheme field makes the cutover explicit; operators rotate by deploying the key and requiring `keyed-v1`, then retiring legacy identities.
- [Dual-RPC disagreement bricks honest users when providers lag] → Mitigation: 0.1% tolerance and agreement only when a secondary is configured; default remains single-source with documented risk.
- [Challenge text grows with wallet count] → Mitigation: 20-wallet cap bounds it; wallets sign the exact membership they see.
- [Mutex only serializes one process] → Mitigation: documented; real deployments run the SQL store with row locks, and the multi-instance case needs the DB as the serialization point.

## Migration Plan

1. Deploy enclave with `SIXFIGS_NULLIFIER_KEY` set and verifier/backend allowing both `legacy-v1` and `keyed-v1`.
2. Flip verifier/backend to `keyed-v1` only; legacy identities stop being accepted for new registrations.
3. Retire legacy rows per data-retention policy. Rollback is reversing step 2.
