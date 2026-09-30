# Design

## Context

Baseline: `tee/` ships TypeScript source with `.ts`-extension imports and no build step, which neither NestJS `tsc` nor Next.js webpack can consume. The backend (NestJS + Prisma + Redis, Solana-only, JWT sessions) stores base64url addresses and computes eligibility from live balances. The frontend (Next.js 14, Solana wallet adapter) renders exact totals and per-wallet balances. Tee's `prepare()` generates its own nonce, so a backend cannot bind a registration to a session. See proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- App repos consume tee as a versioned dependency with zero protocol code outside `tee/`.
- A submitted attested result is provably bound to the logged-in session that performed it.
- No exact totals or per-wallet balances reach one more release after cutover.

**Non-Goals:**
- EVM wallets in the apps (tee already supports EVM; app-side wagmi + chain support is Phase 3).
- Retiring `addressEnc` for login routing (login inherently reveals the address; only wealth linkage is removed).
- Touching `main` of either app repo; all app work happens on feature branches.

## Decisions

- **Compiled dist with export map, not source imports.** `tsc` emit to `dist/` with `./client`, `./verifier`, `./shared` subpaths; enclave keeps type-stripped source. Alternative: git submodule or copy-paste — rejected; submodules drift, copies fork the protocol.
- **Pinned git-URL dependency first, registry later.** `"@sixfigs/tee": "github:A-Mannan/6figs-tee#<sha>"` needs no registry account and pins exact code; move to npm/GitHub Packages when versioning churn demands it.
- **Backend-issued single-use nonce (Redis, short TTL) threaded through `prepare({nonce?})` and checked as `expectedNonce`.** Alternative: accept bearer results and match wallet sets against stored addresses — rejected; it requires the backend to keep seeing addresses forever and replays across users.
- **New Prisma tables mirroring `tee/db/schema.sql`, plus `User.identityNullifier`.** Alternative: reusing `Wallet`/`EligibilityCache` rows for bindings — rejected; it entangles pseudonymous registry data with address-bearing rows.
- **Tier mapping 1→I, 2–3→II, 4→III** as the default proposal; product owner confirms before Phase 1 merges.
- **Keep backend login flow untouched.** Tee replaces only the wealth-proof path (`eligibility/check`, `eligibilityCache` writes); SIWE-style login, JWT sessions, rooms/chat stay as they are.

## Risks / Trade-offs

- [Submitted result belongs to another user] → Mitigation: single-use session nonce consumed on verify; consumed nonces are deleted before verification so double-submit fails closed.
- [Frontend bundle pulls enclave code] → Mitigation: export map exposes only client/verifier/shared; add a bundle-size/import-lint CI check in the frontend branch.
- [`total`/`balances` removal breaks profile UI and possibly other consumers] → Mitigation: grep all `eligibility.total` / `balances` readers in both repos during Phase 1/2; rooms gating already uses tier strings only.
- [Key/distribution confusion between legacy and keyed schemes] → Mitigation: backend `allowedNullifierSchemes` starts as both during rotation, narrows to `keyed-v1`.

## Migration Plan

1. Phase 0 lands in `tee/` and is tagged; attestation digest pinned in app configs.
2. Backend branch deploys TeeModule alongside the old flow; new wallets skip `addressEnc`; both eligibility paths readable.
3. Frontend branch ships the prove flow; profile UI switches to tier-only display.
4. Old `eligibility/check` balance path is deleted; legacy rows retired per retention policy. Rollback is reverting to the pre-cutover commits.
