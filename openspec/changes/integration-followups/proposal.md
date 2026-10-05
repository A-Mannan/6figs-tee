# Proposal

## Why

`integration-product` shipped the tee-first identity: email accounts, top-3
disclosure, encrypted address escrow, and TTL rechecks. Four gaps keep it from
production, and one flow makes daily use painful:

- The escrow key is read from `SIXFIGS_ESCROW_KEY` in the enclave environment,
  so the workload operator can decrypt every stored address. The launch gate
  requires the key to be released only to the attested image.
- There is no mailer and no password recovery. A user who forgets a password
  cannot get back in, and a stolen password cannot be rotated.
- Adding a wallet requires every already-enrolled wallet to re-sign a challenge
  that lists the whole set. That is friction at best and impossible when an old
  wallet is lost; users will not keep every wallet installed to add a new one.
- `Wallet.addressEnc` still holds base64 addresses for legacy rows, the last
  readable-address store in the schema.

One misconception to settle: the identity nullifier does **not** grow with the
wallet set. It is a fixed 32-byte commitment (64 hex characters) whether there
is 1 wallet or 20. What grew was the challenge message and the escrow blob —
both linear in the number of wallets. Additions remove the former from the
signing path and cap the latter at the existing 20-wallet limit.

## What Changes

- **KMS-bound escrow key.** A pluggable `EscrowKeyProvider` loads the escrow
  private key at boot: GCP Cloud KMS unwrap authenticated by the Confidential
  Space attestation token through Workload Identity Federation, with the
  environment key kept as an explicit dev/staging fallback and `none` failing
  closed for rechecks and additions. `/hello` advertises which provider holds
  the key. Production refuses an environment-only escrow key unless the
  explicit override is set.
- **Mailer and email recovery.** A `MailerService` (nodemailer SMTP when
  configured, console transport in dev, boot-refusal in production without
  SMTP), signup email verification, forgot-password reset through hashed
  single-use tokens, authenticated password change, and session invalidation
  after a password change.
- **Add-only wallet membership.** A wallet can be added by signing a compact
  challenge with only the new wallet; the enclave decrypts the stored escrow
  blob, merges the new wallet, re-verifies the resulting set, and signs a
  result that binds the previous identity, the added set, and a fresh escrow
  blob. The backend enforces superset semantics against its stored bindings,
  replaces the blob atomically, and rejects any result that removes a wallet.
  Removal leaves the product entirely.
- **`addressEnc` retirement.** The column is dropped by migration, all legacy
  plaintext address reads and writes are deleted, and wallet listings serve
  labels only. Legacy eligibility stops computing live balances because no
  address exists to read.
- **Disclosure minimization.** The stablecoin share leaves the signed result
  and the database, and the legacy per-chain percentage cache (`assetPct`)
  leaves storage and friend views. `POLICY_VERSION` moves to
  `6figs-tee-2026-10-c` so the wider body cannot be replayed.

## Capabilities

### New Capabilities
- `enclave-kms-keys`: attested key release through GCP KMS and workload
  identity, provider advertisement, fail-closed boot.
- `email-recovery`: mailer abstraction, signup verification, password reset,
  password change, session invalidation.
- `wallet-additions`: add-only transitions with new-wallet-only signatures,
  compact challenges, enclave-side escrow merge, and backend superset checks.
- `address-retirement`: no readable address column; legacy balance reads dead.
- `disclosure-minimization`: no stable share in results or storage, no
  allocation percentages at rest or in friend views.

### Modified Capabilities
- `membership-challenge`: the full-set challenge applies to establishment and
  full re-proving; additions use a per-wallet challenge bound to the account
  pseudonym.

## Impact

- `tee/`: key provider module, KMS unwrap client, `/hello` provider field,
  addition request/result fields, compact addition challenge, escrow merge,
  client `prepareAddition`/`submitAddition`, verifier shape checks,
  `POLICY_VERSION` bump, tests, docs, rebuilt `dist/`.
- `6FIGS.XYZ_backend` (tee-integration branch): mailer module + nodemailer,
  `EmailToken` model + `User.emailVerifiedAt`/`passwordChangedAt`, verification
  and recovery endpoints, add-transition persistence, removal rejection,
  `addressEnc` migration and code deletion, new tee dependency pin.
- `6FIGS.XYZ_frontend` (tee-integration branch): add-wallet-only prove flow,
  verification banner, forgot/reset/change password UI, no removal UI.
- Operations: KMS key ring, workload identity pool/provider, and the wrapped
  escrow key become deploy-time inputs; SMTP credentials become a launch
  requirement.