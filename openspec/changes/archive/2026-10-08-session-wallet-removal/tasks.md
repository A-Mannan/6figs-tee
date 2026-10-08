# Tasks

> Resume here. Tee first; the backend and frontend changes land on their
> `tee-hosted` branches after the tee change is verified. Mark a task `- [x]`
> only after its stated verification passes.

## 1. Tee

- [x] 1.1 `SessionRemovalPayload` and `removePortfolio`: decrypted set,
  commitment check, nullifier target lookup, kept set, fresh balances and
  escrow, signed transition; verified by e2e (remove one, wrong identity,
  unknown target, remove all)
- [x] 1.2 `POST /removal` with the same rate limit, concurrency gate, replay
  cache, and envelope decryption as `/recheck`
- [x] 1.3 `RemovalClient` server-side helper and client barrel export
- [x] 1.4 `POLICY_VERSION` bump and docs (`INTEGRATION.md`, `SECURITY.md`,
  `AGENTS.md` membership paragraph)
- [x] 1.5 `npm test` (134/134), `npm run typecheck`, OpenSpec validate

## 2. Backend (`tee-hosted`)

- [x] 2.1 `TeeIdentity` keyed by `userId` with `identityNullifier` as a unique
  derived column; migration (`20261006130000_tee_identity_user_key`); verified
  by `npm run build`
- [x] 2.2 Wallet removal endpoint: session check, `/removal` call, atomic
  commitment/blob/binding swap, exact set enforcement, `previousIdentityNullifier`
  check (`tee.controller.ts` DELETE `tee-wallet/:walletId`,
  `tee.service.ts` `removeWallet`); verified by `npm run build`

## 3. Frontend (`tee-hosted`)

- [x] 3.1 Registered-wallet list (label + family) with Remove button and
  confirmation (`profile/page.tsx`, `removeTeeWallet`); verified by `npm run build`
- [x] 3.2 Superseded: live browser address captions were removed by the
  frontend owner; the wallet list shows family and label only ("ADDRESS HIDDEN
  BY DESIGN"), and addresses never reach the backend