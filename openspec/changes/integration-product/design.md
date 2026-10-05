# Design

## Context

Baseline: `tee/` proves a tier end-to-end with real attestation, keyed nullifiers, and session-bound nonces (Phase 0 shipped, dev VM live). The backend (NestJS, Prisma, Redis, JWT) still authenticates by wallet signature, stores base64url addresses, and computes eligibility from live balances. The frontend (Next.js 14, Solana wallet adapter) renders exact totals and per-wallet balances. Product tiers are now I/II/III/IV at $100k/$300k/$500k/$1M — the tee's ids 1–4 exactly, so no collapse is needed.

## Goals / Non-Goals

**Goals:**
- Email accounts with wallets linked by a one-time proof; no address or balance at rest in plaintext anywhere.
- A tier that is re-verified silently (TTL 1h) and fails closed when unfresh.
- A profile that shows tier, coarse band, and top-3 asset symbols and nothing numeric.
- Membership changes that stay all-wallets-sign but take one guided flow.
- Zero protocol code in the app repos; app work on feature branches only.

**Non-Goals:**
- EVM wallets in the apps (tee supports them; wagmi/chain support comes later).
- Password reset/verification email delivery (needs a mailer; tracked as a launch dependency).
- A production enclave fleet, HA, or load balancing (dev VM exists; prod hosting is a separate step).
- On-chain or KMS-backed escrow key in code now (the key provider is pluggable; KMS is a launch gate).

## Architecture

Three parties, two trust boundaries:

```
Browser                    Backend (NestJS)                 Enclave (Confidential Space)
───────                    ────────────────                 ─────────────────────────────
email login (JWT)          users, sessions, rooms
connect wallets            TeeIdentity + escrowBlob         escrow private key
prepare() ◄──────────────── tee-nonce (Redis, single-use)   ephemeral session keys
  │                        │                                │
  │ verify /hello attestation (pinned digest+project)         │
  │ sign ownership challenge per wallet                       │
  └──── POST /registration (encrypted to enclave) ───────────►│ verify signatures, fetch balances,
                                                             │ price, tier, topAssets, nullifiers
       signed result + attestation ◄─────────────────────────┘ sign result + attestation token
  │
  │ POST /eligibility/tee-register {signed, escrowBlob} ────►│ verify, persist, link user
  │
  │ GET /profile ───────────────────────────────────────────►│ if verifiedAt > TTL:
                                                             │   POST /recheck {envelope(escrowBlob, nonce)}
                                                             │◄─ new attested signed result
                                                             │ update tier/topAssets/verifiedAt
```

Trust boundaries:
- **Browser ↔ enclave:** end-to-end encrypted; attestation pinned client-side; the backend never sees the registration request.
- **Backend ↔ enclave:** the backend holds only ciphertext it cannot decrypt; the enclave proves itself to the backend via `/hello` attestation pinned in config; recheck results are signed and nonce-bound.
- **Escrow:** the browser encrypts addresses to the enclave escrow key; only a workload holding the escrow private key can decrypt. Addresses exist at rest only as ciphertext.

## Flows

**First prove (email account):**
1. User signs up/logs in with email → JWT.
2. Profile shows "no tier yet"; user connects wallets (adapter).
3. Frontend asks backend for a session nonce (`POST /eligibility/tee-nonce`).
4. Frontend verifies `/hello` (digest + project pinned), then `prepare({wallets, nonce})`.
5. Wallet adapter signs `prepared.message` for each wallet, sequentially with progress.
6. Frontend encrypts the wallet set to `hello.escrowPublicKey` → `escrowBlob`.
7. Frontend submits the envelope to the enclave, verifies the attested result, POSTs `{signed, escrowBlob}` to the backend.
8. Backend verifies with `expectedNonce`, persists `TeeIdentity` (tier, band, topAssets, escrowBlob) + `TeeWalletBinding`s, links to `userId`.
9. Profile now renders tier badge, band, top-3 symbols.

**Silent re-verification (TTL 1h):**
1. Any authenticated read of profile/eligibility/room gate checks `verifiedAt`.
2. If older than `TEE_RECHECK_TTL_MS`, the backend takes a Redis lock and calls the enclave `POST /recheck` with `{escrowBlob, identityNullifier, nonce, timestamp}` encrypted to the enclave session key.
3. Enclave decrypts the escrow blob with the escrow key, recomputes the identity from the wallet set, refuses on mismatch, re-fetches balances, prices, and returns a signed attested result with the same body shape plus `topAssets`.
4. Backend verifies signature + attestation + `expectedNonce`, updates tier/band/topAssets/verifiedAt/expiresAt.
5. If the enclave is unreachable and the last result has expired, the identity is marked unverified and gated; when it is still fresh, the last known tier is served with a `stale` flag. Never silently upgrade.

**Membership change (add/remove, all wallets sign):**
1. One guided modal; `prepare` runs once for the whole transition (new set + removals).
2. Every enrolled wallet signs the new-set challenge; removed wallets sign the removal consent.
3. Submit → enclave verifies every signature, produces the new identity + nullifiers.
4. Frontend produces a fresh escrow blob for the new set and POSTs `{signed, escrowBlob}`; backend replaces the stored blob atomically with the bindings.
5. Same session nonce for the whole attempt; on failure nothing is persisted.

**Email accounts:**
- `email` + `passwordHash` (scrypt, per-user salt, `node:crypto`), JWT sessions unchanged.
- Wallet login endpoints remain for legacy accounts during migration; `POST /wallet/verify` may attach a wallet to the current session (existing behavior).
- Password reset/verification is out of scope; the account is usable immediately in dev.

## Decisions

- **Four-tier identity mapping, shared helper.** The product thresholds now match the tee's; the helper maps 1→I … 4→IV and stays the single source both apps use. Dev builds mirror the product's devnet thresholds so faucet money exercises the real tier code.
- **Top-3 symbols, never amounts.** `topAssets` is always disclosed, sanitized (`^[A-Z0-9]{1,10}$`), capped at 3, and each must hold ≥5% by value so dust/fingerprint tokens do not enter the profile. Alternative: full allocation under `disclosure` — rejected as a numeric leak the product does not need. The stablecoin share was removed for the same reason (`integration-followups`).
- **Escrow via the existing envelope.** X25519 + HKDF + AES-256-GCM already exists; the escrow key is a second long-lived keypair advertised in `/hello` and bound into the key attestation nonce. Alternative: backend-envelope to a per-boot key — rejected; rechecks must survive restarts.
- **Backend-triggered recheck, lazy + locked.** One Redis lock per identity prevents stampedes; the enclave result is signed and nonce-bound, so the backend never has to trust the channel. Alternative: client-triggered probes — rejected; they cannot refresh inactive users and add wallet-signature friction.
- **All-wallets-sign transitions stay.** Smoothness comes from one nonce, one modal, sequential signing, and resumable UX — not from weakening the invariant. A single leaked session must not be able to add a wallet and take over an account.
- **No `addressEnc` for tee wallets; legacy retained.** Login no longer needs addresses (email), and rechecks use ciphertext. Legacy wallet rows stay until a retention decision so wallet-only accounts keep working.
- **Escrow key provider is pluggable.** Dev: `SIXFIGS_ESCROW_KEY` via tee-env. Production: the same code path must load a KMS-wrapped key released only to the attested image; the env path is dev-only by launch policy.

## Risks / Trade-offs

- [Top-3 symbols are a fingerprint] → Mitigation: symbols only, 5% floor, max 3, sanitized; documented as deliberate disclosure alongside tier.
- [Escrow operator risk] → Mitigation: production key must be KMS-bound to the attested image; a stolen dev key never protects real users; recheck is the only consumer.
- [Recheck enables a tier oracle for blob holders] → Mitigation: blobs are only produced by the verified owner's browser, stored server-side behind auth; the enclave binds `expectedIdentityNullifier` so a swapped blob cannot change identity.
- [Stale tiers during enclave outage] → Mitigation: fail closed at `expiresAt`; serve last-known with `stale` until then; never upgrade without a fresh signed result.
- [Email accounts weaken the "wallet is the account" model] → Mitigation: membership changes still require all wallets; email only carries the session and identity link.
- [Scrypt cost on the request path] → Mitigation: parameters at the Node default target (~100ms); rate-limit login attempts in Redis.

## Migration Plan

1. Tee Phase 0 additions land and are tagged; dev VM is rebuilt and smoked (tier, top-3, recheck).
2. Backend branch adds models + TeeModule alongside the old flow; legacy users keep wallet login; tee users skip `addressEnc` and balance reads.
3. Frontend branch ships email auth + prove/re-prove + tier/top-3 profile; old total UI is removed for tee users.
4. After both branches merge and dev is stable, legacy eligibility path is deleted and retention of `addressEnc` is decided separately. Rollback is reverting the app branches; the tee additions are backward compatible until `POLICY_VERSION` is enforced.

## Operational Dependencies (launch gates, not dev blockers)

- KMS-attested escrow key before any production deployment.
- Mailer for password reset/verification before public signups.
- Production enclave hosting (VM fleet + LB) as a separate step; the dev VM path is already working.