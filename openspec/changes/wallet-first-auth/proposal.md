# Proposal: wallet-first auth (no email)

## Why

The product moved to a wallet-first identity: an account is born from a wallet
proof, and device-free sign-in is an optional username + password. Email
authentication contradicted that model and has been removed. Because the
backend must never see an address, every wallet flow — signup, sign-in, and
recovery — runs through the attested enclave and resolves accounts by keyed
nullifiers.

## What changes

- **REMOVE** `email-accounts` and `email-recovery`: no email signup,
  verification, reset, or mailer.
- **ADD** `wallet-first-auth`: one proven wallet signs in or creates the
  account; more wallets are added incrementally; any enrolled wallet recovers a
  forgotten username or password through the enclave; username + password is
  opt-in.
- **MODIFY** `backend-tee-module`: sessionless `tee-login` and `tee-identify`
  resolve owners from attested bindings; sessionless nonces are claimed
  atomically and bounded by the attested creation time.
- **MODIFY** `frontend-tee-flow`: wallet-first entry replaces the email UI,
  with a username sign-in / wallet recovery page and a completion prompt for
  remaining wallets.
- **MODIFY** `address-retirement`: wallet authentication no longer reads or
  stores address-derived hashes; the legacy address-hash login and the legacy
  `Wallet` table are removed.

## What does not change

- The enclave protocol: login and recovery reuse the existing establish proof
  and escrow blob; no signed-body or policy change.
- Session-authorized wallet removal and TTL recheck baselines.
- One proven wallet carries full account authority (documented tradeoff).

## Non-goals

- Email as a notification channel.
- A dedicated lightweight enclave `/wallet-login` endpoint (deferred
  hardening; login currently reuses the establish path and recomputes balances
  and prices).