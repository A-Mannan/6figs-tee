# Proposal

## Why

The TEE verification core is complete, tested, and pushed, but no product code consumes it: the frontend still displays exact totals and per-wallet balances from server-side balance reads, and the backend still stores reversible addresses and computes eligibility from live RPC data. Until the three repos are wired together, the privacy guarantee exists only in `tee/`. This change defines that wiring without breaking team ownership: protocol code stays versioned in `tee/`, product code stays in the app repos.

## What Changes

- Tee ships a compiled distributable (`dist/` with an export map for `./client`, `./verifier`, `./shared`); the enclave keeps running source directly. App repos consume it as a versioned dependency and never edit protocol code.
- Tee client `prepare()` accepts a caller-supplied `nonce` so the backend can bind a registration to a session; plus a tier-label mapping helper shared by both apps.
- Backend gains a `TeeModule`: an authenticated single-use nonce endpoint, a `SignedRegistration` verification endpoint with `expectedNonce`, a Prisma `NullifierStore` on new tables mirroring `tee/db/schema.sql`, and tier mapping into `EligibilityCache`. New wallets stop populating `addressEnc`; eligibility stops live balance reads for tee-verified users.
- Frontend gains a `teeVerify` flow on the profile page (prepare → sign per wallet via the wallet adapter → submit → POST result), re-proof on wallet add/remove, and enclave policy env config. Solana-only first.
- **BREAKING (product contract, not crypto):** the `Eligibility` API shape loses exact `total` and per-wallet `balances` for tee-verified users; the profile UI must be redesigned for "tier badge, no numbers". Tee's 4 tiers map onto the backend's 3 (`1→I, 2–3→II, 4→III`, pending product approval).

## Capabilities

### New Capabilities
- `packaging-distribution`: compiled tee distributable with a stable export map consumed as a versioned dependency.
- `protocol-prereqs`: caller-supplied registration nonce and shared tier-label mapping in tee.
- `backend-tee-module`: nonce issuance, attested result verification, nullifier persistence, and tier mapping in the NestJS backend.
- `frontend-tee-flow`: browser prove/re-prove flow against the enclave and backend in the Next.js frontend.

### Modified Capabilities
- None. All touched capabilities are new; the baseline specs in `openspec/specs/` are unaffected.

## Impact

- `tee/`: `package.json` (exports, build script), `tsconfig.build.json` (new), `src/client/register.ts` (`nonce?` input), new tier helper, `docs/INTEGRATION.md` rewrite. Enclave runtime untouched.
- `6FIGS.XYZ_backend` (feature branch only, never `main`): new `TeeModule`, Prisma migration (`TeeIdentity`, `TeeWalletBinding`, `User.identityNullifier`), `EligibilityService` tee path, env additions.
- `6FIGS.XYZ_frontend` (feature branch only, never `main`): new `src/lib/teeVerify.ts`, profile prove/re-prove UI, env additions.
- Operators must provision `SIXFIGS_NULLIFIER_KEY` and pin the enclave digest in both app configs.
