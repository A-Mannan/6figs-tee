# Design: wallet-first auth

## Decisions

### One wallet proves the account

The first proven wallet decides everything: an attested wallet already bound to
an identity signs into that account without mutating the stored set, and a
fresh wallet creates the account with that wallet. More wallets are added one
at a time through the existing signed-addition transition, each re-proving the
merged set and refreshing the tier. The tier is conservative: it can be
understated until the set is complete, never overstated, so the UI prompts the
user to add their remaining wallets.

### Sessionless login reuses the establish proof

`POST /eligibility/tee-login` accepts the same attested establish result and
escrow blob as registration and resolves the owner from `TeeWalletBinding`.
A strict subset of an active identity returns a session without touching the
binding, tier, or blob. A fresh set creates the account. There is no
pre-issued nonce: the backend claims the attestation nonce atomically at
submit (first submitter wins) and rejects proofs older than the replay window
by their attested `createdAt`. This avoids a policy bump and keeps the
"backend never sees an address" invariant. A dedicated lightweight enclave
proof is deferred; if login volume makes the balance/price work matter, it is
the next change.

### Recovery by any enrolled wallet

`POST /eligibility/tee-identify` verifies a sessionless establish proof whose
wallets must all be enrolled, resolves the single owning identity, and returns
the account's username plus a single-use, 15-minute recovery token. The token
lets the holder rename the account and set a new password (which invalidates
old sessions) and signs them in. Recovery works with any subset of the enrolled
set including one wallet; no wallet has to be linked for recovery in advance,
and no address hash is stored.

### Credentials are opt-in and private

A username + password attaches to the wallet-born account from the profile.
The username is a private credential distinct from the public `handle`; only a
salted scrypt hash is stored; attempts are throttled (10 per 10 minutes per
username); a password change bumps `passwordChangedAt` so older JWTs fail. No
reset email exists: forgetting either credential is recovered by a wallet
proof.

### One AppKit stack for EVM and Solana

The frontend adopts Reown AppKit (ex-WalletConnect) with the wagmi and Solana
adapters, replacing the Solana-only wallet-adapter stack. The product only
signs messages — no transactions — so the connector is used purely to select a
wallet, connect, and sign. The flow stays one wallet per proof run: connect,
sign, disconnect. EVM addresses use `chainId: 0` (all supported EVM chains;
the same address signs on any of them) with EIP-191 `personal_sign`; Solana
uses ed25519. Provider names become wallet labels.

### Security posture

One proven wallet carries full account authority, including the
session-authorized removal baseline. This is accepted product direction and
documented in `docs/SECURITY.md`; a compromised single wallet is a full
account compromise. Future countermeasures (delay or notification on
membership changes, optional second factor) are out of scope here.

## Alternatives considered

- **Dedicated enclave `/wallet-login` proof**: lighter per login, but adds a
  protocol/policy bump and an image rebuild for a path the establish flow
  already covers. Deferred.
- **Backend-verified wallet signatures with an address-hash index**: simpler,
  but the platform would see the address and store a second address-derived
  hash. Rejected on the privacy invariant.
- **Batched all-wallets signup**: fewer steps for users with many wallets, but
  forces every wallet into one session and complicates loss recovery; the
  incremental add path already exists and re-tiers each time.

## Risks

- **Tier understatement until the set is complete.** Mitigated by the
  completion prompt; the displayed tier is never higher than the attested set
  supports.
- **Login cost.** Every sign-in recomputes balances and prices for the proven
  subset and is subject to registration limits. Acceptable at current scale;
  see the deferred hardening task.
- **AppKit dependency and project ID.** Reown requires a project ID for the
  modal (free); wallet connectivity now depends on a third-party SDK for UI
  only, not on trust.
- **Username enumeration and brute force.** Rate-limited with generic errors;
  usernames remain publicly visible on profiles as `handle`, while the
  credential username is private.