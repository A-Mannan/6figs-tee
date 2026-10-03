# Design

## Context

Baseline: `integration-product` shipped (Phase 0 and both app branches built,
escrow + recheck + email accounts live on a dev VM). The escrow key is a raw
X25519 private key in the enclave environment; recovery is email-less; adding a
wallet re-runs the full-set challenge; `Wallet.addressEnc` is still in the
schema. The dev enclave holds `SIXFIGS_ESCROW_KEY`; production has no enclave.

## Goals / Non-Goals

**Goals:**
- The operator cannot decrypt stored addresses: the escrow key is released only
  to an attested image through KMS.
- A user can verify their email, recover a forgotten password, and change a
  known password; password changes kill old sessions.
- Adding a wallet needs one signature, from the new wallet, and never requires
  an old wallet to be online.
- No schema column can carry a readable address after migration.

**Non-Goals:**
- KMS-backed or OPRF nullifiers (tracked in `harden-phase-3`; this change only
  moves the escrow key). `SIXFIGS_NULLIFIER_KEY` stays an env key until then.
- Wallet removal. The protocol keeps the machinery for compatibility, but the
  product, the client SDK surface, and the backend reject it.
- Email deliverability/domain setup, templates beyond plain text, or bounce
  handling; the mailer is an interface plus SMTP.
- Threshold recovery for lost wallets. Add-only plus email recovery covers the
  common case; a lost wallet still cannot be detached.

## Architecture

### KMS-bound escrow key

```
Enclave boot
  │
  ├─ SIXFIGS_KMS_KEY set ──► attestation token (launcher socket)
  │                            │
  │                            ▼
  │                     GCP STS token exchange          (workload identity)
  │                            │
  │                            ▼
  │                     iamcredentials impersonate      (optional service account)
  │                            │
  │                            ▼
  │                     Cloud KMS :decrypt               (wrapped 32-byte X25519 key)
  │
  ├─ SIXFIGS_ESCROW_KEY set ──► env provider (dev/staging; refused in prod unless
  │                             SIXFIGS_ALLOW_ENV_ESCROW_KEY=1)
  └─ neither ────────────────► provider "none": registrations run, recheck/add refuse
```

`EscrowKeyProvider.load()` returns `{ privateKey, provider, keyId? }` or throws.
The unwrap is one boot-time call; the KMS DEK policy grants
`cloudkms.cryptoKeyDecrypter` only to the workload identity principal set that
matches the attested image digest and project. `SIXFIGS_KMS_WRAPPED_ESCROW_KEY`
is the only escrow secret that lives in deploy config, and it is useless
without the attested workload. An optional AAD binds the ciphertext to the
image digest.

`/hello` gains `escrowKeyProvider: "kms" | "env" | "none"` and
`escrowKeyId?: string`. The key attestation nonce still binds the escrow public
key; the provider field is metadata the client policy may require (`kms` in
production). The public key never changes when only the wrapping changes.

### Add-only membership

```
Browser ─── POST /eligibility/tee-nonce ────────────► Backend
        ◄── { nonce, add: { identityNullifier, escrowBlob } }      (verified users)
  prepareAddition(added, escrowBlob, baseIdentity, nonce)
  added wallet signs ONE compact message
  ─── POST /registration (envelope{mode:"add", escrowBlob, wallets:[added+sig],
        baseIdentityNullifier, nonce}) ──────────────► Enclave
                                                       decrypt blob with escrow key
                                                       recompute base identity; mismatch → refuse
                                                       verify only the added wallets' signatures
                                                       merge old ∪ added (≤ 20)
                                                       fetch balances/prices, assign tier
                                                       re-encrypt merged set → nextEscrowBlob
                                                       sign result {previousIdentity,
                                                         addedWalletNullifiers, nextEscrowBlob}
  ─── POST /eligibility/tee-register {signed} ───────► Backend
                                                       verify attestation + nonce
                                                       stored identity == previousIdentity
                                                       stored bindings ⊆ new set
                                                       added == new − stored; removals rejected
                                                       replace identity + bindings + blob atomically
```

The enclave is stateless; the escrow blob is the state carrier. The browser
never needs old addresses: it forwards the opaque blob it just fetched. The
backend never learns them either. The added wallet's message is:

```
6figs: add a wallet to your account
Domain: 6figs-wallet-add-v1
Account: <identityNullifier>
Wallet: <family:address>
Nonce: <nonce>
Issued At: <iso>
```

It binds the account pseudonym, the wallet, and the attempt; it does not list
the set, so its size is constant regardless of account size. The enclave still
runs the establishment challenge (which lists the set) for first proofs and
re-proves, preserving the "the signer sees what they authorize" property where
the signer can actually see the set.

Result-body additions (present only for add mode):

- `previousIdentityNullifier` — the stored identity this transition extends.
- `addedWalletNullifiers` — entries proven by signatures in this transition.
- `nextEscrowBlob` — the merged set encrypted to the same escrow key.

The verifier accepts these fields only as a complete triple; the backend
cross-checks them against stored state. The `nonce` still binds the fresh
session, and the attestation token still binds the exact canonical body, so a
forged or replayed addition fails like any other result.

### Email recovery

Prisma gains `User.emailVerifiedAt`, `User.passwordChangedAt`, and
`EmailToken { userId, kind, tokenHash, expiresAt, consumedAt }`. Raw tokens are
32 random bytes, base64url-encoded into the link; only the SHA-256 hash is
stored. Verification tokens live 24 h, reset tokens 30 min, both single-use via
a conditional `updateMany` that only consumes an unconsumed, unexpired row.

`MailerService` uses nodemailer when `SMTP_HOST` is present and logs the link
through the Nest logger otherwise. Production boot fails without SMTP unless
`SIXFIGS_ALLOW_CONSOLE_MAILER=1`. After a password change or reset,
`passwordChangedAt` is bumped and `JwtGuard` rejects tokens whose `iat` precedes
it, so a stolen session does not survive a rotation.

### `addressEnc` retirement

A migration drops `Wallet.addressEnc`. `auth.service.ts` stops writing it;
`wallet.service.ts`, `profile.service.ts`, and `eligibility.service.ts` stop
reading it. Legacy wallet-signature login keeps working because it uses
`addressHash` and the nonce signature, neither of which needs the plaintext.
Legacy accounts still authenticate but no longer get live balance eligibility:
without an address there is nothing to read, and `EligibilityService` serves
only tee-verified records (or no tier). The frontend stops rendering legacy
totals. This is deliberate: keeping a readable address column to preserve a
deprecated feature contradicts the privacy invariant.

## Decisions

- **KMS unwrap, not KMS-native keys.** X25519 has no Cloud KMS equivalent, so
  the escrow key stays an X25519 keypair and KMS wraps it. The wrapped key is
  released to attested workloads only; rotating the KMS KEK re-wraps the same
  key and addresses stay decryptable.
- **Workload identity federation from the attestation token.** No long-lived
  service-account key in the image; the STS exchange validates the token
  audience, and KMS sees only the resulting short-lived access token. All calls
  use raw `fetch`, matching the enclave's no-extra-deps rule.
- **Keep the env provider, gate it explicitly.** Local tests and the dev VM
  need it; production refuses it unless the operator sets the documented
  override, so the launch gate cannot be silently skipped.
- **Add-only mount, not a second endpoint.** `mode` in the existing encrypted
  registration request reuses the session-key envelope, replay cache, rate
  limit, and concurrency gate. A new endpoint would duplicate all four.
- **The enclave merges, not the client.** Under keyed nullifiers the browser
  cannot recompute identities, and old addresses must not round-trip. The
  enclave holds the escrow key, so it is the only party that can merge and
  re-commit the set.
- **Only the added wallet signs; the session authorizes.** The trade-off is
  explicit: whoever holds the email session plus control of the added wallet
  can extend the account. That is the point of smooth additions; email
  verification, rate limits, and password recovery are the guards. The old
  all-wallets rule remains for establishment, which is when the account is
  born.
- **Removals rejected at the trust boundary.** The enclave can still build a
  removal result, but the backend refuses any result carrying
  `removedWalletNullifiers`, so no product path can detach a wallet.
- **`EmailToken` table over JWT links.** Reset links must be single-use and
  revocable; a stored hash with `consumedAt` gives that without a second
  signing key.

## Risks / Trade-offs

- [Email session plus added wallet takes over the account] → Accepted and
  documented; verification before first proof, attempt rate limits, and
  password rotation are the mitigations. Establishment still requires every
  wallet.
- [KMS outage at boot] → The enclave refuses to boot with an unloadable key
  rather than serving rechecks that will fail later; a single boot retry loop
  is left to the platform.
- [Wrapped key in deploy config] → Useless without the attested identity; AAD
  ties ciphertext to the image digest; the KEK policy is the enforcement point.
- [Migration drops legacy addresses irreversibly] → The data is base64 of
  public addresses with no amounts; the product already decided no readable
  address at rest. Take a one-time encrypted backup if operations requires it.
- [Password reset emails in dev are logged] → Console transport is dev-only and
  gated; production boot fails closed without SMTP.
- [Add requests grow the escrow blob linearly] → Capped at 20 wallets by
  `MAX_WALLETS`; a 20-wallet blob is a few KB, far below the 256 KB body limit
  and Postgres `text`.

## Migration Plan

1. Tee lands first: key provider + `/hello` field, addition protocol, client
   and verifier, policy `6figs-tee-2026-10-b`, tests, `dist/`, docs.
2. Backend pins the new tee commit, adds mailer/models/endpoints, add
   persistence, removal rejection, then runs the `addressEnc` migration.
3. Frontend pins the new tee commit, ships add-only UI and account recovery UI.
4. Rollback: the result shape is additive; reverting the app branches leaves
   the old all-wallets flow working only if the tee allows it — it does, because
   establishment is unchanged. KMS can be disabled by unsetting
   `SIXFIGS_KMS_KEY` and using the explicit env override on dev.

## Operational Dependencies

- KMS key ring + workload identity pool/provider, a wrapped escrow key, and
  the IAM binding to the attested principal set.
- SMTP host/credentials/from address before public signups.