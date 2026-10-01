# Design

## Context

The backend verifier (`src/verifier/index.ts`) accepts PKI (x5c) tokens and RS256 OIDC tokens from Google Cloud Attestation. The PKI root may come from config (`pkiRootPem`) or be fetched at runtime. The enclave (`src/enclave/server.ts`) runs a single-threaded Node HTTP server with no request controls. See proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- Any attestation path that cannot be fully validated rejects (fail closed).
- A single registration request has bounded RPC, pricing, and memory cost.
- Production deployment surfaces no debug/mock defaults.

**Non-Goals:**
- No KMS-OPRF, signed price feeds, or threshold wallet transitions (tracked in `docs/SECURITY.md` improvements).
- No Postgres store, backend controller, or frontend auth changes (out of this folder).

## Decisions

- **PKI: throw instead of degrade.** `verifyPkiToken` takes a mandatory root PEM and validates the leaf chain signature plus both validity windows. `AttestationVerifier.loadPkiRoot` propagates fetch failures; `verifyToken` maps them to `VerificationError("pki_root_unavailable")` and signature failures to `pki_invalid`. Alternative considered: caching a stale root indefinitely — rejected, because a rotated Google root would then permanently fail or permanently trust old material.
- **Allowlist checks instead of allowlist silence.** Empty `allowedImageDigests`/`allowedProjects` previously disabled checks. Now the checks raise `policy_not_configured`. Alternative: a separate `unsafeAllowAny` flag — rejected; there is no legitimate production case for accepting arbitrary workloads.
- **Fail-closed conventions duplicated across verifier and browser client** (`checkTokenClaims` exported from `src/verifier/index.ts`, `assertAttestationClaims` exported from `src/client/attestation.ts`) so each is directly unit-testable without network or Google fixtures.
- **In-process controls, not LB-only controls.** `FixedWindowRateLimiter` and `ConcurrencyGate` live in `src/enclave/limits.ts` so the workload is protected even when the fronting proxy does no throttling. Per-IP attribution uses the socket address because the deployment may preserve source IP; this is documented as best-effort behind NAT/proxies.
- **Budget fails the request, never truncates silently.** The 30 s registration budget (dev/test override `SIXFIGS_REGISTRATION_BUDGET_MS`) throws `budget_exceeded` rather than pricing a subset, which would understate the tier and could look like a privacy feature. `MAX_ASSETS_PER_REQUEST=300` undercounts by design and is public in `src/shared/constants.ts`.
- **Supply chain: pin what the trust anchor touches.** The image digest is the code users trust, so base image (`node:22-bookworm-slim` pinned by digest), dependencies (`npm ci --ignore-scripts` + root `.npmrc`), and `engines >= 22.6` (the minimum for `--experimental-strip-types`) are locked.

## Risks / Trade-offs

- [Per-IP limiting behind a shared load balancer] → the socket address may be the proxy, collapsing all users into one bucket; mitigated by the concurrency gate and generous per-IP cap; operators should terminate with source-IP preservation.
- [Budget env override changes behavior] → `SIXFIGS_REGISTRATION_BUDGET_MS` only shortens the window and fails closed, so it cannot inflate tiers; document it as a dev/test knob.
- [Strict empty-allowlist rejection breaks local flows] → mitigation: the mock provider path returns before claim checks, so `allowMock` dev flows are untouched.
