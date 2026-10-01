# Tasks

> Resume here: everything below is pending. Start at Phase 0 in `tee/`; do not
> touch app repos until Phase 0 is tagged. App work happens on feature branches
> only — never push to `main` of `6FIGS.XYZ_frontend` or `6FIGS.XYZ_backend`.
> Read `## Blockers` before starting: several items below cannot proceed until
> someone outside this repo decides or provisions something.

## Blockers

- [ ] B1 Product decision (owner: you) — approve the 4→3 tier mapping (tee ids
  1→I, 2–3→II, 4→III) or specify an alternative. Blocks Phase 1 merge; the
  mapping changes backend tier writes and room-gating copy.
- [ ] B2 Product decision (owner: you) — approve the no-totals profile redesign
  (`total`/`balances` disappear for tee-verified users). Blocks Phase 2 UI work;
  the `teeVerify` lib itself (2.1) can proceed regardless.
- [ ] B3 Infrastructure (owner: enclave operator) — no production enclave is
  deployed. Phase 1/2 integration testing runs against local mock attestation
  only until a VM exists with a published URL, a pinned digest for both app
  configs, and a `SIXFIGS_NULLIFIER_KEY` provisioning story.
- [ ] B4 Coordination (owner: Ibrahim) — app work lives in his repos. Agree on
  feature-branch names and the review/merge process before Phase 1/2 start.
- [ ] B5 Data policy (owner: you) — confirm scope is wealth-linkage only:
  login still reveals addresses, and `addressEnc` retirement follows a
  retention decision, not this change.

## 0. Tee-side prerequisites (this repo)

- [x] 0.1 Add `tsc` build emitting `dist/` with `package.json` exports for `./client`, `./verifier`, `./shared`; verify by importing all three subpaths from a scratch NestJS-style `tsc` project and a Next.js-style webpack build (webpack half deferred: no npm registry in this environment, so verified via NodeNext tsc + node ESM through the exports map instead; the real Next.js build in Phase 2 is the final proof)
- [x] 0.2 Accept optional `nonce` in client `prepare()` input and echo it into the request; verify by a test asserting a caller nonce round-trips into `body.nonce`
- [x] 0.3 Add a shared tee-tier-id → product-tier-label helper used by both apps; verify by unit test covering ids 0–4
- [x] 0.4 Pin the dependency as `github:A-Mannan/6figs-tee#<tag-sha>` in docs; verify by fresh `npm install` resolving byte-identical code

## 1. Backend TeeModule (feature branch `tee-integration`, never `main`)

- [ ] 1.1 Add Prisma models `TeeIdentity`, `TeeWalletBinding` mirroring `tee/db/schema.sql` plus `User.identityNullifier`; verify by `prisma validate` and a migration that applies cleanly
- [ ] 1.2 Implement the Prisma `NullifierStore` with single-transaction `runTransaction` semantics; verify by porting the tee store conformance cases (bind conflict, migration, concurrent transitions)
- [ ] 1.3 Add authenticated `POST /eligibility/tee-nonce` (Redis single-use, short TTL) and `POST /eligibility/tee-verify` (expectedNonce + persist + link identity); verify by an authenticated happy-path test and a replayed-nonce rejection test
- [ ] 1.4 Map tee tiers to product tiers into `EligibilityCache` and stop `addressEnc` writes plus live balance reads for tee-verified users; verify by a test asserting no balance RPC occurs on the tee path

## 2. Frontend tee flow (feature branch `tee-integration`, never `main`)

- [ ] 2.1 Add `src/lib/teeVerify.ts` wrapping `RegistrationClient` with the wallet adapter signer; verify by a mocked-adapter test driving prepare → sign → submit
- [ ] 2.2 Wire the profile "prove" button and wallet add/remove re-proof to the backend nonce endpoints; verify by an end-to-end devnet run against mock attestation
- [ ] 2.3 Redesign profile/eligibility display to tier-only (no totals, no per-wallet amounts, no progress bar); verify by rendering tests and grep proving no `eligibility.total` readers remain
- [ ] 2.4 Add enclave policy env (`NEXT_PUBLIC_ENCLAVE_URL`, digest, project); verify by a boot check failing closed on missing config

## 3. Later (separate changes, not this one)

- [ ] 3.1 EVM wallets: wagmi integration in frontend, chain support in backend auth, tee already supports EVM; verify per-wallet-family tests
- [ ] 3.2 Retire `addressEnc` for login routing and legacy eligibility rows per retention policy; verify by schema migration and dead-code grep
