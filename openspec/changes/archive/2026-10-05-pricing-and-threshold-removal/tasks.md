# Tasks

> Resume here. Testing environment only: production provisioning stays deferred
> in `integration-followups`. Tee first, then backend, then frontend. Read
> `## Blockers` before starting.

## Blockers

- [x] B1 Direction — oracles and OPRF dropped; CoinGecko → GeckoTerminal →
  DexScreener fallback chosen; removal requires all kept wallets (owner
  direction 2026-10-05).
- [~] B2 Optional provider keys — GeckoTerminal and DexScreener work keyless at
  low volume; keys only raise limits. Not blocking.

## 0. Multi-source pricing (tee)

- [x] 0.1 Chain config gains `geckoterminalNetwork` and `dexscreenerChainId`;
  providers skip unmapped chains; verified by unit tests for the mappings
- [x] 0.2 `GeckoTerminalPricing` provider (token price by network + address);
  verified with a scripted fake fetch (hit, miss, malformed, non-OK)
- [x] 0.3 `DexScreenerPricing` provider (pairs by token, best-liquidity price
  on the matching chain); verified with a scripted fake fetch
- [x] 0.4 Compose `CoinGecko → GeckoTerminal → DexScreener`; first valid quote
  wins, caching unchanged, par cap applies to fallback quotes, native assets
  never par-capped; verified by fallback-order tests
- [x] 0.5 Docs (`docs/INTEGRATION.md`, `docs/SECURITY.md`); verified by review

## 1. Threshold removal (tee)

- [x] 1.1 Protocol: `mode: "remove"`, `walletThresholdRemovalChallenge`,
  removal triple validation in the verifier; `POLICY_VERSION` to
  `6figs-tee-2026-10-d`; verified by typecheck + verifier tests
- [x] 1.2 Enclave removal path: decrypt blob, verify base identity, exact
  kept/removed partition, kept signatures, re-encrypt kept set, sign; refuses
  without escrow material; verified by tests (success/lost wallet, missing
  kept signature, unknown removed, remove-all, swapped blob, no key)
- [x] 1.3 Client `prepareRemoval`/`submitRemoval` with local legacy-scheme
  checks; verified by client tests
- [x] 1.4 Rebuild `dist/` and record the commit; verified by build + consumer
  typecheck

## 2. Backend (Resend + removal)

- [x] 2.1 `MailerService` uses Resend when `RESEND_API_KEY` is set (replace
  the `re_xxxxxxxxx` placeholder), SMTP fallback, console dev; `.env.example`
  updated; verified by build + a dev send path
- [x] 2.2 `TeeService` removal branch: previous identity same-user, stored =
  kept ∪ removed, no overlap, at least one kept; replace identity, bindings,
  blob atomically; verified by live smoke (remove a wallet, then add another)
- [x] 2.3 Pin the new tee commit; verified by typecheck/build/lint

## 3. Frontend (removal UI)

- [x] 3.1 Remove-wallet flow: enter/select the removed address, reconnect and
  sign with every kept wallet, submit; add flow unchanged; verified by
  typecheck/lint/build
- [x] 3.2 Pin the new tee commit; verified by build

## 4. Verification

- [x] 4.1 Tee: `npm test`, `npm run typecheck`, `npm run build` green
- [x] 4.2 Backend: typecheck/build/lint + live smoke for removal and Resend
  console path
- [x] 4.3 Frontend: typecheck/lint/build green
- [x] 4.4 Docs: pricing providers, removal model, Resend env; validated by
  `openspec validate pricing-and-threshold-removal --strict`