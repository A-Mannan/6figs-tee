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
- [ ] 0.3 Identity tier mapping: update `productTierLabel` to 1→I … 4→IV; add dev tiers (10/100/500/1000 USD) when `SIXFIGS_DEV_CHAINS=1`; verify by unit tests for both modes
- [ ] 0.4 Add `topAssets` (≤3 sanitized symbols, ≥5% share) to the signed result and verifier validation; verify by tests covering ordering, floor, sanitization, and body acceptance
- [ ] 0.5 Escrow keypair in the key manager from `SIXFIGS_ESCROW_KEY`, advertised in `/hello` and bound into the key attestation nonce; verify by tests for hello binding, substitution rejection, and explicit recheck refusal without persistent material
- [ ] 0.6 `POST /recheck`: decrypt escrow blob, enforce `expectedIdentityNullifier`, re-fetch balances/prices, sign an attested result bound to the nonce; verify by tests for success, identity mismatch, and missing-key refusal
- [ ] 0.7 Client helpers: `encryptEscrowBlob()` plus a Node-safe `RecheckClient` used by the backend (hello pinning + envelope + result verification); verify by tests with a stub enclave
- [ ] 0.8 Bump `POLICY_VERSION`, update docs (`ATTESTATION.md`, `INTEGRATION.md`, `SECURITY.md` privacy invariants); verify by verifier rejecting the old version
- [ ] 0.9 Rebuild the dev image, recreate the dev VM, and smoke tier + top-3 + recheck against real attestation (`scripts/smoke-enclave.ts`); verify by recorded smoke output
- [x] 0.10 Document the pinned git dependency and release tag process (`docs/INTEGRATION.md`).

## 1. Backend branch (`6FIGS.XYZ_backend`, feature branch)

- [ ] 1.1 Prisma models `TeeIdentity` (tier, tierLabel, portfolioBand, stableBps, topAssets, policyVersion, escrowBlob, verifiedAt, expiresAt) and `TeeWalletBinding`, plus `User.email`/`User.passwordHash`; verify by `prisma validate` and a clean migration on dev
- [ ] 1.2 Email auth: signup/login with scrypt via `node:crypto`, rate-limited, same JWT; update `AuthModule`; verify by tests for hash format, duplicate email, bad credentials, and rate limit
- [ ] 1.3 Redis-backed single-use nonces for tee registration/recheck bound to the session; verify by happy path and replay rejection
- [ ] 1.4 TeeModule: verify `SignedRegistration` with `expectedNonce`, persist tier/topAssets/escrowBlob/bindings transactionally, link to user; verify by porting tee store conformance tests (bind conflict, transition, concurrent submits)
- [ ] 1.5 TTL re-verifier: `RecheckClient` call, per-identity Redis lock, update on success, fail closed at expiry, `stale` flag while fresh; verify by tests with a stub enclave for success, outage, and expiry
- [ ] 1.6 Read paths: profile/eligibility return tier, band, top-3 symbols, wallet labels — no totals/percentages; stop `addressEnc` writes for tee wallets; verify by response-shape tests and a grep proving no `eligibility.total`/`balances` readers remain in the tee path
- [ ] 1.7 Legacy compatibility: wallet-signature login keeps working; email link preserves the account; rooms gate on mapped labels incl. TIER IV; verify by migration test and room-gate test
- [ ] 1.8 Full backend verification: `npm run typecheck`, `npm run build`, `npm run lint`, `npm test`

## 2. Frontend branch (`6FIGS.XYZ_frontend`, feature branch)

- [ ] 2.1 Email signup/login UI and session handling; verify by a mocked-API test and manual dev run
- [ ] 2.2 `src/lib/teeVerify.ts`: session nonce fetch, `RegistrationClient` wrap, escrow blob creation from `/hello`, result POST; verify by a mocked-adapter test driving nonce → prepare → sign → submit → POST
- [ ] 2.3 Prove/re-prove UI with per-wallet progress and decline handling; verify by rendering tests for success, partial, and declined states
- [ ] 2.4 Guided add/remove wallet flow (single modal, all-wallets signing, fresh escrow blob); verify against the dev enclave end-to-end
- [ ] 2.5 Profile redesign: tier badge, band, top-3 symbols, wallet labels, silent refresh, stale marker; verify by rendering tests and a grep proving no total/percentage readers remain
- [ ] 2.6 Tier-IV copy/gating in rooms and any tier lists; verify by rendering test
- [ ] 2.7 Enclave policy env (`NEXT_PUBLIC_ENCLAVE_URL`, digest, project) with a boot check that fails closed on missing config; verify by the check rejecting empty config
- [ ] 2.8 Full frontend verification: `npm run typecheck`, `npm run build`, `npm run lint`

## 3. Cutover and handoff

- [ ] 3.1 Tag the tee release and pin it in both app branches; verify by fresh `npm install` resolving the same commit
- [ ] 3.2 Open PRs on `tee-integration` branches for Ibrahim's review; never target `main`
- [ ] 3.3 Record the dev VM digest/URL in both app PRs and in `docs/DEV-ENCLAVE.md`; verify by a live smoke run
- [ ] 3.4 Decide `addressEnc` retention/migration for legacy rows and file it as a follow-up change; verify by a written decision in the PR