# Proposal

## Why

The TEE proves wealth without exposing addresses or balances, but the product still runs on the old model: wallet-only login, reversible addresses at rest, live balance reads, and a profile that renders exact totals. The product direction is now concrete — four tiers matching the tee exactly, web2 email accounts linked to wallets, a display of tier plus top-3 assets, and silent hourly re-verification so a tier can never go stale. This change wires the three repos together around that model: protocol additions stay in `tee/`, product code stays in the app repos, and app work happens on feature branches only.

## What Changes

- **Tier model converges.** Product tiers are now I $100k / II $300k / III $500k / IV $1M (`backend/src/common/tiers.ts`), exactly the tee's ids 1–4. The shared helper maps identity; the earlier 4→3 collapse is dead. When dev chains are enabled the tee mirrors the product's devnet thresholds (10/100/500/1000 USD) so faucet-funded dev wallets can prove real tiers.
- **Top-3 assets.** The signed result gains `topAssets: string[]` — up to three sanitized asset symbols ordered by value, each at least 5% of the portfolio, never amounts. The profile displays tier, band, and these symbols; totals, percentages, and progress bars are gone.
- **Encrypted address escrow.** The browser encrypts the wallet set to a persistent enclave escrow key (X25519 ECIES, same envelope code) and hands the blob to the backend. The backend stores ciphertext it cannot read and replays it to the enclave to re-verify.
- **Silent hourly re-verification.** A new enclave `POST /recheck` decrypts an escrow blob, re-fetches balances, and returns a fresh attested, signed result bound to a backend nonce. The backend triggers it lazily when a verified identity is older than the TTL (default 1h) and fails closed once the last result has expired.
- **Email accounts.** `User` gains `email` + `passwordHash` (scrypt via `node:crypto`, no new dependency). Email signup/login coexist with legacy wallet login during migration; proving wallets links the tee identity to the logged-in account.
- **`addressEnc` retirement for tee users.** New tee-linked wallets never write `base64` addresses; legacy rows stay until a retention decision. Eligibility reads for tee users serve only the stored attested record.
- **Smooth membership changes.** The all-wallets-sign invariant stays (it is the takeover protection); the frontend makes it one guided flow with per-wallet progress, and the backend binds it to a single session nonce.

## Capabilities

### New Capabilities
- `packaging-distribution` (unchanged): compiled tee distributable with a stable export map consumed as a versioned dependency.
- `address-escrow`: attested persistent enclave escrow key, client-side blobs, and the attested `/recheck` round trip.
- `email-accounts`: email + password accounts linked to wallets, coexisting with legacy wallet login.

### Modified Capabilities
- `protocol-prereqs`: four-tier identity mapping with dev thresholds, caller nonce, and `topAssets` in the signed result.
- `backend-tee-module`: escrow storage, TTL re-verification, email linking, tier/top-3 persistence, and the no-address/no-balance rule made concrete.
- `frontend-tee-flow`: email auth, prove/re-prove, top-3 display, and the guided transition flow.

## Impact

- `tee/`: key manager (escrow key + hello binding), registration result (`topAssets`), new `recheck` endpoint, dev tiers, client escrow/recheck helpers, `POLICY_VERSION` bump, tests, docs, dev image.
- `6FIGS.XYZ_backend` (feature branch only): Prisma models (`TeeIdentity`, `TeeWalletBinding`, `User.email/passwordHash`), auth email endpoints, `TeeModule`, TTL recheck, profile/eligibility read changes.
- `6FIGS.XYZ_frontend` (feature branch only): email auth UI, `teeVerify` lib with escrow blobs, prove/re-prove and wallet transition UX, tier + top-3 profile, tier-IV room copy.
- Operations: production escrow key must be KMS-bound to the attested image (launch gate); a mailer is required before password reset/verification ships.