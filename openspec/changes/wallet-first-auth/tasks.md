# Tasks

> Resume here. Reconcile the wallet-first auth that already shipped in the app
> repos, then finish the remaining work: Reown AppKit (EVM + Solana),
> wallet-set completion prompt, legacy cleanup. Mark a task `- [x]` only after
> the stated verification passes.

## 0. Shipped reconciliation (verified)

- [x] 0.1 Pulled backend `335cc5c` + frontend `e03dc2c` implement email
  removal, sessionless `tee-login` / `tee-identify`, opt-in username
  credentials, and recovery via any enrolled wallet; verified by `npm run build`
  in both app repos (2026-10-08)
- [x] 0.2 `session-wallet-removal` archived and its capability synced; verified
  by `openspec validate --specs` (25/25)

## 1. Frontend: Reown AppKit (EVM + Solana)

- [x] 1.1 `@reown/appkit` 1.8.24 + wagmi/Solana adapters, viem, react-query;
  `NEXT_PUBLIC_REOWN_PROJECT_ID` documented in `.env.example`; three
  build-blockers fixed — `@wagmi/connectors` pinned to 6.2.0 (AppKit's optional
  peer resolved to the wagmi-3 line), `bs58` pinned to 4.0.1 (v6 is ESM-only
  and crashed every page at prerender), `@x402` aliased out (optional Base
  Account signer, Coinbase disabled); verified by `npm run build`
- [x] 1.2 `SolanaProviders` deleted; one AppKit provider wraps the app; `Header`
  disconnects through AppKit; no wallet-adapter import remains; verified by
  `npm run build`
- [x] 1.3 Family-agnostic prove flow: family parsed from the CAIP namespace,
  EVM `personal_sign` hex, Solana ed25519 base58, `chainId: 0`, provider name as
  the label; `mode="identify"` drives recovery from the same state machine;
  verified by `npm run build`, `npm run typecheck`, `npm run lint` (device
  smoke with real wallets is task 5.2)
- [x] 1.4 All `@solana/wallet-adapter-*` and `@solana/web3.js` dependencies
  removed; verified by `npm run build`

## 2. Frontend: completion prompt

- [x] 2.1 While exactly one wallet is enrolled the profile shows "your tier
  reflects the one wallet connected so far — add your other wallets, it can
  only go up", dismissible; self-clears once a second wallet is added;
  verified by `npm run build`

## 3. Backend cleanup

- [x] 3.1 Dropped the legacy `Wallet` model (migration
  `20261008120000_drop_legacy_wallet_table`) and the whole `wallet` module;
  `ProfileService.me` serves tee bindings only; the eligibility fallback is
  now `source: "none"` with no wallet count; "disconnect all" moved to
  `DELETE /eligibility/tee-identity` (wipes identity + bindings + tier cache,
  keeps the username sign-in); verified by `npm run build` and
  `prisma validate`
- [x] 3.2 Removed the unused `resend`, `nodemailer`, and `@types/nodemailer`
  dependencies; no mailer source references remain; verified by
  `npm run build`

## 4. Deferred hardening (do not start without a trigger)

- [ ] 4.1 Lightweight enclave `/wallet-login` proof so repeat logins skip
  balance and price work (protocol bump + image rebuild); start only if login
  cost or rate limits become a problem

## 5. Verification

- [x] 5.1 `npm test` (134/134) + `npm run typecheck` in tee — no enclave
  change was needed
- [ ] 5.2 Dev smoke with real wallets: EVM-only signup → tier → username
  set/change → second-device password login → wallet sign-in with EVM and
  with Solana → recovery via any enrolled wallet → add wallet → remove wallet
  → disconnect all → recheck. **Needs a browser and two funded/devnet
  wallets; not runnable in this environment.**
- [ ] 5.3 `npx -y @fission-ai/openspec@1.13.2 validate wallet-first-auth`;
  sync specs, archive (blocked on 5.2)