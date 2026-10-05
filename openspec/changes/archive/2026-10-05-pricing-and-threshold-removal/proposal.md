# Proposal

## Why

Two product directions changed since the hardening plan was written, and a
third was confirmed:

- **Oracle feeds are out.** Chainlink/Pyth do not cover the long tail this
  product holds, especially graduated memecoins with no oracle market. Pricing
  needs to reach on-chain DEX liquidity, not a signed feed.
- **OPRF is out.** The keyed-HMAC nullifier scheme stays; the blind-OPRF
  hardening is dropped rather than built.
- **Removal should be threshold-based.** The add flow stays as shipped
  (only the new wallet signs). Removing a wallet — often the lost one — should
  need every *kept* wallet to sign, so a lost wallet never needs its own key.
- The environment is testing-only, so production gates stay visible but
  deferred.

`harden-phase-3` planned OPRF, a signed feed, thresholds, and HA. It is
replaced by this change.

## What Changes

- **Multi-source pricing.** CoinGecko remains first (native assets and wide
  token coverage), with GeckoTerminal and then DexScreener as per-asset
  fallbacks for tokens CoinGecko cannot quote. First valid quote wins, cached
  per asset for a short TTL; par-band capping and price-or-skip are unchanged.
  No oracle or signed-feed dependency.
- **Threshold wallet removal.** A new `remove` registration mode decrypts the
  stored escrow blob, requires every kept wallet to sign one compact challenge
  naming the removed wallets, and needs nothing from the removed (possibly
  lost) wallet. The enclave signs the new identity, the removed nullifiers, and
  a fresh escrow blob for the kept set. The backend accepts the transition only
  when the stored set exactly equals kept ∪ removed, the previous identity
  belongs to the session user, and at least one wallet stays. The add flow is
  untouched: only the added wallet signs.
- **Resend email delivery.** The NestJS mailer uses the Resend API when
  `RESEND_API_KEY` is set (replace the `re_xxxxxxxxx` placeholder), keeping
  the console transport for local dev.
- **Deferred production gates.** KMS provisioning, SMTP/Resend credentials,
  and production enclave hosting are marked post-testing in
  `integration-followups`; OPRF and signed-price-feed work is deleted.

## Capabilities

### New Capabilities
- `multi-source-pricing`: CoinGecko → GeckoTerminal → DexScreener fallback
  pricing for native and long-tail token assets.
- `threshold-removal`: removal of one or more wallets authorized by every kept
  wallet, with no signature from the removed wallet.

### Modified Capabilities
- `frontend-tee-flow`: the guided flow covers one-signature additions and
  threshold removals; the removed wallet is entered, not connected.
- `backend-tee-module`: escrow replacement covers both merged (add) and pruned
  (remove) blobs with stored-set equality checks.
- `membership-challenge`: a threshold removal challenge names the removed
  wallet(s) and the account, signed by each kept wallet.

## Impact

- `tee/`: pricing providers + chain network slugs, removal challenge and
  registration mode, client `prepareRemoval`/`submitRemoval`, verifier removal
  triple, `POLICY_VERSION` bump, tests, docs, rebuilt `dist/`.
- `6FIGS.XYZ_backend`: `TeeService` removal branch, Resend in `MailerService`,
  dependency pin bump.
- `6FIGS.XYZ_frontend`: remove-wallet UI (paste the address, reconnect kept
  wallets, sign once each), dependency pin bump.
- `openspec/changes/harden-phase-3` is deleted; OPRF and signed-feed plans are
  dropped, not deferred.