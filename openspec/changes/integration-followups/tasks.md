# Tasks

> Resume here. Work tee-first, then the backend `tee-integration` branch, then
> the frontend `tee-integration` branch. Tee changes land on `main` (owner
> decision 2026-10-03); app work stays on the existing feature branches. Read
> `## Blockers` first. Mark a task `- [x]` only after its stated verification
> passes.

## Blockers

Dev-resolvable now; production gates:

- [x] B1 Branching — tee work on `main`; both app repos pulled and left on
  `tee-integration` (owner direction 2026-10-03).
- [ ] G1 KMS provisioning — production needs a key ring, a wrapped escrow key,
  a workload identity pool/provider, and the IAM binding to the attested
  principal set. Code ships with env fallback + tests using a fake KMS; real
  GCP credentials are required to smoke the live path.
- [ ] G2 SMTP credentials — production boot refuses without SMTP (or the
  explicit console override).

## 0. KMS-bound escrow key (tee)

- [x] 0.1 `EscrowKeyProvider` seam: env provider, `none`, and selection rules
  (KMS > env > none); production refuses env-only unless the documented
  override is set; verified by unit tests for each boot mode
- [x] 0.2 GCP provider: attestation token → STS exchange → optional service
  account impersonation → Cloud KMS `:decrypt` → 32-byte X25519 key; raw fetch
  only; verified by tests with a scripted fake fetch (honest chain, each
  failure mode, wrong key length)
- [x] 0.3 `/hello` carries `escrowKeyProvider` (+ `escrowKeyId`); client policy
  can require `kms`; verified by hello-binding and policy-rejection tests
- [x] 0.4 Docs + env table (`docs/INTEGRATION.md`, `docs/SECURITY.md`,
  `docs/DEV-ENCLAVE.md`); verified by docs review

## 1. Add-only wallet membership (tee)

- [x] 1.1 Protocol types: `mode`, `escrowBlob`, `baseIdentityNullifier` in the
  request; `previousIdentityNullifier`, `addedWalletNullifiers`,
  `nextEscrowBlob` in the result; `walletAdditionChallenge`; `POLICY_VERSION`
  bump to `6figs-tee-2026-10-b`; verified by typecheck + canonical-JSON tests
- [x] 1.2 Enclave add path: decrypt blob, verify base identity, verify only
  added wallets, reject duplicates/over-cap, merge, value, re-encrypt blob,
  sign; refuses without persistent escrow key; verified by tests (success,
  swapped blob, duplicate, over-cap, missing key, bad signature)
- [x] 1.3 Verifier shape checks for the addition triple + establishment/recheck
  unchanged; verified by verifier tests
- [x] 1.4 Client `prepareAddition`/`submitAddition` with local checks under the
  legacy scheme; verified by client tests incl. constant challenge length for
  1 vs 20 wallets and fixed-length identity nullifier
- [x] 1.5 Server/limits: add requests use the same envelope, nonce replay
  cache, rate limit, and concurrency gate; body-limit and 20-wallet blob-size
  test; verified by limits/e2e tests
- [ ] 1.6 Rebuild `dist/` and record the commit for the app pins; verified by
  `npm run build` + NodeNext consumer import (dist built; commit pending)

## 2. Backend mailer and recovery (`6FIGS.XYZ_backend`)

- [x] 2.1 `MailerModule`/`MailerService` with nodemailer SMTP and console dev
  transport; production boot refusal without SMTP (explicit override);
  verified by typecheck/build + dev-link log check
- [x] 2.2 Prisma: `User.emailVerifiedAt`, `User.passwordChangedAt`,
  `EmailToken` (hashed, single-use, expiring); migration applies cleanly;
  verified by `prisma validate` + `generate` + migration apply on a fresh
  Postgres
- [x] 2.3 Signup verification + resend; forgot/reset; authenticated change;
  session invalidation on rotation; rate limits; generic responses; verified
  by `yarn typecheck`/`build` and live route smoke (verify, forgot, reset,
  change, stale-token 401)
- [x] 2.4 Frontend-facing DTOs include `emailVerified` on session responses;
  verified by build + smoke output

## 3. Backend add persistence and address retirement

- [x] 3.1 Pin the new tee commit; `TeeService.register` accepts the addition
  triple, enforces superset semantics and same-user base identity, replaces
  identity/bindings/blob in one transaction, rejects removals; verified by
  typecheck/build + live smoke (establish → add → 2 bindings; removal 400)
- [x] 3.2 `tee-nonce` response carries `add: { identityNullifier, escrowBlob }`
  for verified users; verified by build + live smoke
- [x] 3.3 Drop `Wallet.addressEnc`: migration, remove all reads/writes
  (`auth`, `wallet`, `profile`, `eligibility`), delete legacy balance-derived
  eligibility; verified by schema audit (`\d "Wallet"` has no addressEnc) +
  build
- [x] 3.4 Docs/env notes for KMS + SMTP + recovery (`.env.example`); verified
  by review

## 4. Frontend account and addition UX (`6FIGS.XYZ_frontend`)

- [x] 4.1 Pin the new tee commit; add-wallet-only flow (connect/sign the new
  wallet, no removal UI); verified by typecheck/lint/build
- [x] 4.2 Account recovery UI: verify banner + resend, forgot/reset/verify
  pages, change-password form; verified by typecheck/lint/build
- [x] 4.3 Remove legacy totals/address readers left in the tee branch
  (profile rewritten to the attested view); verified by grep + typecheck
- [x] 4.4 Full frontend verification: `yarn typecheck`, `yarn lint`,
  `yarn build` green (10 routes incl. `/reset-password`, `/verify-email`)

## 5. Verification and handoff

- [x] 5.1 Tee: `npm test`, `npm run typecheck`, `npm run build` green (107/107)
- [x] 5.2 Backend: `yarn typecheck`, `build`, `lint`, `prisma validate`
  green; migration applied on a fresh local Postgres + live route smoke
  (recovery + add + removal rejection)
- [ ] 5.3 Record dev enclave rebuild needs (new digest if the dev VM is
  rebuilt) and update `docs/DEV-ENCLAVE.md` (doc note added; VM not rebuilt)
- [x] 5.4 Update `docs/ATTESTATION.md` and `docs/SECURITY.md` for the new
  result fields, KMS trust statement, and add-only trade-off