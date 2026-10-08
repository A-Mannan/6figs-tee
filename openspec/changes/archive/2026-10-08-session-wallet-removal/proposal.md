# Proposal

## Why

Removing a wallet currently requires every kept wallet to sign one threshold
challenge. With email accounts, the session already proves who the user is, and
the escrow blob is the capability for the wallet set. Requiring N wallet
popups to delete one wallet makes the common action slow and impossible when
the wallet to remove is exactly the one that was lost.

## What Changes

- New enclave endpoint `POST /removal`: the backend sends the stored escrow
  blob plus the wallet nullifiers to detach; the enclave decrypts the set,
  removes them, re-fetches balances, re-encrypts a fresh escrow blob, and signs
  the same transition body the threshold path returns. No wallet signatures.
- The signed result shape does not change, so the verifier, client policies,
  and storage schema keep working; the backend only replaces commitment, blob,
  and bindings for the same `userId`.
- `identityNullifier` remains the derived set commitment; it is no longer the
  account key. The backend keys `TeeIdentity` by `userId` (already a unique
  column).
- `POLICY_VERSION` moves to `6figs-tee-2026-10-e`.

## Non-goals

- Blind OPRF.
- Deleting the threshold path; it stays in the enclave for compatibility but is
  no longer used by the product flow.
- Wallet re-additions keep their existing signature rule.

## Impact

- `tee/`: types, `removePortfolio`, server route, `RemovalClient`, tests, docs,
  `POLICY_VERSION`, specs.
- Backend `tee-hosted` branch: `TeeIdentity` PK becomes `userId`; wallet
  removal service calls `/removal` instead of the threshold path.
- Frontend `tee-hosted` branch: Remove button on the registered-wallet list;
  live addresses come from the browser, never from the backend.