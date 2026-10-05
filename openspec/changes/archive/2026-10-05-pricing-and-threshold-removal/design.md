# Design

## Context

Baseline: CoinGecko-only pricing with a `fallback` seam already in
`CoinGeckoPricing`; membership is add-only after `integration-followups`
(removal rejected). The old removal machinery (removal consent signed by the
removed wallet) still exists in the enclave and tests but no product path
reaches it. `harden-phase-3` (OPRF, signed feed, HA) is dropped.

## Goals / Non-Goals

**Goals:**
- Price every discovered holding, including tokens CoinGecko misses, without
  an oracle subscription.
- Let a user remove a wallet they still hold *or have lost*, authorized by the
  wallets that remain.
- Keep the add flow exactly as shipped: one signature from the new wallet.

**Non-Goals:**
- OPRF nullifiers, signed price feeds, cross-source price agreement, HA fleets,
  or production KMS/SMTP provisioning (testing environment).
- Removing the last wallet (an account must keep at least one).
- Recovering a wallet set where fewer than N−1 wallets remain accessible; that
  is the same threshold limit, stated plainly.

## Decisions

- **CoinGecko first, DEX aggregators second.** CoinGecko is cheapest for
  native assets and has the broadest symbol coverage; GeckoTerminal and
  DexScreener quote by contract address from live pools. The existing
  `fallback` chain composes them: `CoinGecko(fallback: GeckoTerminal(fallback:
  DexScreener))`. First valid quote wins; no agreement requirement, because
  disagreement would skip exactly the long-tail assets this change exists to
  cover.
- **Network slug mapping on the chain config.** GeckoTerminal
  (`eth`, `base`, `arbitrum`, `optimism`, `polygon_pos`, `solana`) and
  DexScreener (`ethereum`, `base`, `arbitrum`, `optimism`, `polygon`,
  `solana`) ids live beside `coingeckoPlatform` so providers share one source
  of truth. Chains without a mapping are skipped by that provider.
- **Par cap applies to fallback quotes too.** A DEX quote at ~$1.00 is capped
  to $1.00 exactly like a CoinGecko quote, so the cap cannot be bypassed by
  provider choice. Native quotes are never par-capped (a $1 native asset is a
  real price, not a stablecoin).
- **Threshold = all kept wallets.** For one removal that is N−1 signatures;
  for multiple removals it is kept = stored − removed. The removed wallet
  signs nothing, which is what makes a lost wallet recoverable. This is a
  deliberate weakening of the old all-wallets rule: N−1 cooperating wallets
  can evict the Nth, so an attacker with N−1 keys can already do everything
  the Nth could.
- **One challenge, one signature per kept wallet.** The message names the
  account pseudonym and the removed wallet(s); it does not list kept wallets
  (they are implied by who signs). Constant size per kept wallet, matching the
  addition challenge.
- **Escrow blob is the state carrier again.** Removal decrypts the stored
  blob, verifies the claimed base identity, computes kept = stored − removed,
  and re-encrypts the kept set. The backend never learns an address.
- **Backend equality, not subset, on removal.** Additions check superset;
  removals check `stored = kept ∪ removed` exactly, with the same-user
  previous identity, so neither a silent shrink nor a silent growth can pass.
- **Resend over self-hosted MTA.** Running an outbound MTA means port 25 and
  deliverability operations for no testing benefit; Resend is an API call
  behind the existing `MailerService` seam with the console transport for
  local dev.

## Risks / Trade-offs

- [DEX prices are manipulable] → Existing defenses stay: price-or-skip,
  overflow guards, par cap, and tier bucketing; the residual risk is documented
  and accepted. Cross-checking sources is a future option, not a testing gate.
- [Provider rate limits] → Per-asset caching, sequential quoting, and a
  fallback chain that stops at the first hit; GeckoTerminal and DexScreener
  keys are optional.
- [N−1 eviction] → Stated in the model; the account is already email-rooted
  and additions are one-signature, so the marginal risk is small. Removal of
  all wallets is rejected.
- [Lost-wallet UX requires the address] → The removed wallet is entered as an
  address (or chosen when held); the product never stores addresses, so there
  is no picker to build.

## Migration Plan

1. Tee: pricing providers, removal mode, client/verifier, `POLICY_VERSION`
   `6figs-tee-2026-10-d`, tests, docs, `dist`.
2. Backend: pin the new tee, removal persistence, Resend mailer.
3. Frontend: pin the new tee, remove-wallet UI, build.
4. Rollback: additions and establishment are unchanged; a client that never
   sends `remove` behaves exactly as before.