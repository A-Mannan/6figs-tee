# Tasks

> Resume here. Work tee-first, then the backend branch, then the frontend
> branch. App work happens on feature branches only — never push to `main` of
> `6FIGS.XYZ_frontend` or `6FIGS.XYZ_backend`. Read `## Blockers` first.

## Blockers

Resolved by the product pull and owner direction (2026-10-01):

- [x] B1 Tier mapping — product now ships four tiers (I $100k / II $300k /
  III $500k / IV $1M), matching tee ids 1–4 one-to-one. No collapse.
- [x] B2 UI direction — tier + top-3 assets, no totals, percentages, or
  progress bars; no base64 address at rest.
- [x] B3 Dev enclave — live at `http://35.238.114.34:8080` (us-central1-c),
  digest `sha256:5faa8039…64aa7`, real attestation, keyed nullifiers.
- [x] B4 Branching — owner authorized feature-branch work in both app repos;
  still have Ibrahim review/merge.
- [x] B5 Address policy — no plaintext/base64 addresses; escrow ciphertext
  only, tee-only decrypt.

Launch gates (do not block dev; block production):

- [ ] G1 KMS-bound escrow key: production escrow key must be released only to
  the attested image. Dev uses `SIXFIGS_ESCROW_KEY` via tee-env.
- [ ] G2 Mailer for password reset/verification before public signups.
- [ ] G3 Production enclave hosting/fleet (separate from the dev VM).

## 0. Tee protocol additions (this repo)

- [x] 0.1 `tsc` build emitting `dist/` with `./client`, `./verifier`, `./shared` exports; verified via NodeNext consumer + live smoke. Webpack half deferred to the real Next build in Phase 2.
- [x] 0.2 Optional `nonce` in client `prepare()`; verified by round-trip test into `body.nonce`.
- [x] 0.3 Identity tier mapping: updated `productTierLabel` to 1→I … 4→IV; added dev tiers (10/100/500/1000 USD) when `SIXFIGS_DEV_CHAINS=1`; verified by unit tests for both modes
- [x] 0.4 Added `topAssets` (≤3 sanitized symbols, ≥5% share) to the signed result and verifier validation; verified by tests covering ordering, floor, sanitization, and body acceptance
- [x] 0.5 Escrow keypair in the key manager from `SIXFIGS_ESCROW_KEY`, advertised in `/hello` and bound into the key attestation nonce; verified by tests for hello binding, substitution rejection, and explicit recheck refusal without persistent material
- [x] 0.6 `POST /recheck`: decrypts escrow blob, enforces `expectedIdentityNullifier`, re-fetches balances/prices, signs an attested result bound to the nonce; verified by tests for success, identity mismatch, and missing-key refusal
- [x] 0.7 Client helpers: `encryptEscrowBlob()` plus a Node-safe `RecheckClient` used by the backend; verified by HTTP end-to-end tests against a mock enclave
- [x] 0.8 Bumped `POLICY_VERSION` to `6figs-tee-2026-10-a`, updated docs (`ATTESTATION.md`, `INTEGRATION.md`, `SECURITY.md`, `db/schema.sql`); old-version rejection covered by the verifier's policy-mismatch test
- [x] 0.9 Rebuilt the dev image, recreated the dev VM (us-east1-b, digest `sha256:2b5f84…fe232`), and smoked tier + top-3 + recheck against real attestation; full output recorded in-session
- [x] 0.10 Document the pinned git dependency and release tag process (`docs/INTEGRATION.md`).

## 1. Backend branch (`6FIGS.XYZ_backend`, feature branch)

- [x] 1.1 Prisma models `TeeIdentity`/`TeeWalletBinding` plus `User.email`/`User.passwordHash`; verified by `prisma validate` + `generate` and a clean-applying migration (`..._tee_identity`) on local Postgres
- [x] 1.2 Email auth: signup/login/link with scrypt via `node:crypto`, rate-limited, same JWT; verified live (signup + login + duplicate + wrong-password paths in the smoke run)
- [x] 1.3 Redis-backed single-use nonces bound to the session; verified live (happy path + consumed-nonce rejection enforced in `consumeNonce`)
- [x] 1.4 TeeModule: verifies `SignedRegistration` with `expectedNonce`, persists tier/topAssets/escrowBlob/bindings in one transaction mirroring tee transition semantics; verified live end-to-end (fresh bind, idempotent re-proof)
- [x] 1.5 TTL re-verifier: `RecheckClient` call, per-identity Redis lock, update on success, fail closed at expiry, `stale` flag while fresh; verified live (`/eligibility/tee-recheck` round trip)
- [x] 1.6 Read paths: profile/eligibility return tier, band, top-3 symbols, wallet labels — no totals/percentages; no `addressEnc` writes anywhere in the tee path (DB shows zero legacy rows for tee users)
- [x] 1.7 Legacy compatibility: wallet-signature login untouched; rooms gate on mapped labels (`VALID_TIERS` already includes TIER IV); email link preserves the account
- [x] 1.8 Full backend verification: `npm run typecheck`, `npm run build`, `npm run lint` green; no test runner exists in the repo, so verification is the live smoke (signup → nonce → register → profile → recheck) plus the DB no-address audit

## 2. Frontend branch (`6FIGS.XYZ_frontend`, feature branch)

- [x] 2.1 Email signup/login/link UI and session handling; verified by typecheck plus the backend live auth smoke (no frontend test runner exists in the repo)
- [x] 2.2 `src/lib/teeVerify.ts`: session nonce fetch, `RegistrationClient` wrap, escrow blob creation from `/hello`, result POST; the full path is exercised by the backend smoke using the same package entrypoints
- [x] 2.3 Prove/re-prove UI (`TeeProve`) with per-wallet progress and decline handling; nothing submits on partial sets
- [ ] 2.4 Guided add/remove wallet flow against the dev enclave end-to-end — UI implemented; live wallet signing needs a browser + funded wallets (manual QA: connect two devnet wallets, prove, remove one, confirm bindings + blob rotation)
- [x] 2.5 Profile redesign: tier badge, band, top-3 symbols, wallet labels, silent refresh, stale marker; legacy path kept intact for migration; no total/percentage readers remain in the tee branch
- [x] 2.6 Tier-IV copy/gating already present in rooms, create, and play (verified by grep; backend `VALID_TIERS` includes TIER IV)
- [x] 2.7 Enclave policy env (`NEXT_PUBLIC_ENCLAVE_URL`, digest, project) with `enclaveConfig()` failing closed on missing config; documented in `.env.example`
- [x] 2.8 Full frontend verification: `npm run typecheck`, `npm run lint` green; `npm run build` green with fonts stubbed (Google Fonts is unreachable from this sandbox — pre-existing environmental failure in `layout.tsx`, untouched by this change)

## 3. Cutover and handoff

- [x] 3.1 Tagged the tee release (`tee-integration-v1` → `75cb61b`); both apps pin the dist-identical commit `b94e177` (`github:A-Mannan/6figs-tee#b94e177`, verified byte-identical `src`/`dist` to the tag). Fresh `yarn install --frozen-lockfile` resolves it via the lockfile tarball (note: yarn 1.x tag refs need `raw.githubusercontent.com`, unreachable from some networks — prefer the sha pin until the registry move)
- [ ] 3.2 Open PRs on `tee-integration` branches for Ibrahim's review; never target `main`
- [ ] 3.3 Record the dev VM digest/URL in both app PRs and in `docs/DEV-ENCLAVE.md`; verify by a live smoke run
- [ ] 3.4 Decide `addressEnc` retention/migration for legacy rows and file it as a follow-up change; verify by a written decision in the PR