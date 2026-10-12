# Tasks: tier-zero-admission

> DONE 2026-10-12. Released (`tee-2026-10-12`), both apps bumped, enclave
> rotated to `656d1a96` on policy `-f` with the KMS gate pinned, live tier-0
> proof green, backend `main` merged (bot rail reconciled, TIER I restored)
> and pushed, frontend `main-v2` pushed. Remaining is deploy-side only:
> Render envs + `prisma migrate deploy`, Netlify env + rebuild (see task 3.4
> notes and the operator handoff).

## 0. Tee (this repo)

- [x] 0.1 `TIERS` / `DEV_TIERS` id-0 label `"none"` → `"$0+"`; verified by `npm test` (tier.test.ts, product.test.ts) and `npm run typecheck`
- [x] 0.2 `productTierLabel`: 0 → `"0"`, unknown ids still null; verified by product.test.ts
- [x] 0.3 Tier-0 band follows the active tier set (`<100k` prod, `<10` dev); verified by tier.test.ts
- [x] 0.4 `POLICY_VERSION` bumped to `6figs-tee-2026-10-f`; verifier policy-mismatch behavior unchanged, full suite green (146/146)
- [x] 0.5 `npm run build` emits updated `dist/` (spot-checked `productTierLabel(0) === "0"` from `dist/`)

## 1. Backend (`6FIGS.XYZ_backend`, current branch)

- [x] 1.1 `common/tiers.ts`: `TIER 0` in the union, thresholds, list, `tierOf`; `tierRank` 0-based with unknown → −1
- [x] 1.2 `tee.service.ts`: tier-0 proofs label `TIER 0`; eligibility cache row written for every admitted tier; stored view serves tier 0 as verified; subset wallet login allowed for tier-0 accounts; legacy incoherence escape documented
- [x] 1.3 Room gates: `VALID_TIERS` adds `TIER 0`; play gate copy "Verify your wallets in Profile first"
- [x] 1.4 `SIXFIGS_EXPECTED_POLICY_VERSION=6figs-tee-2026-10-f` in `.env`
- [x] 1.5 Verified: `npm run typecheck` + `npm run lint` green (two pre-existing lint errors removed: unused `randomBytes` import, unused `removed` destructure)
- [x] 1.6 `@sixfigs/tee` bumped to `github:A-Mannan/6figs-tee#tee-2026-10-12`; `yarn install` resolved (lock pins commit d826124), typecheck/lint/build green, backend restarted and serving five tiers
- [x] 1.7 Reconciled with the bot rail on `origin/main` (2026-10-12, backend merge `75d3bbf`): the TIER I-at-$0 threshold hack is dropped (tier 0 carries the floor, TIER I is back to $100k/10-dev), bot matchmaking/group-rooms/charts kept; conflicts resolved in `tiers.ts` (thresholds), `play.service.ts` (gate copy), `tee.service.ts` (theirs was prettier-only + the same two lint fixes); their charts commit's unused-var lint error fixed; `prisma generate` + local `migrate deploy` run for the group-rooms columns; typecheck/lint/build green

## 2. Frontend (`6FIGS.XYZ_frontend`, current branch)

- [x] 2.1 `TIER_ORDER` + `tierRank` include TIER 0 (0-based); `tierEdgeClass("TIER 0") → t0` with CSS for the tag and the assay cell; landing strip is five columns
- [x] 2.2 Create page offers TIER 0 for tier-0 holders and snaps the default within their ceiling; rooms filter adds "Tier 0 only"
- [x] 2.3 Play copy: "prove your wallets" replaces the tier-bar framing; docs ladder and band diagram describe five tiers
- [x] 2.4 Verified: `npm run typecheck` + `npm run lint` green (no frontend test runner exists)
- [x] 2.5 `@sixfigs/tee` bumped to `github:A-Mannan/6figs-tee#tee-2026-10-12`; `yarn install` resolved, typecheck/lint green

## 3. Release and rollout

- [x] 3.1 Tee release (2026-10-12): commit `d826124` pushed to `main`, tag `tee-2026-10-12` pushed; `dist/` rebuilt and committed; 148/148 tests + `tsc` clean
- [x] 3.2 Enclave rotated (2026-10-12): image `sha256:656d1a9630717d8557ef5d3d1ba18859c38eaa736bbb76df5a0350648da2aa3d` built with `scripts/build-image-dev.sh`, preflighted locally, KMS gate (WIF provider condition — found absent, re-added) pinned to it, VM `sixfigs-enclave-dev` metadata updated + reset; live `/hello` attests the new digest with `escrowKeyProvider: kms`, `policyVersion: 6figs-tee-2026-10-f`. App pins set to `new, 95261f8a` (rollback), orphan `9805c99f` dropped; backend restarted
- [x] 3.3 Live tier-0 proof: `scripts/tier0-proof.ts` (kept as the rotation check) — fresh wallet through `https://tee.6figs.xyz` with real attestation: tier 0, label `$0+`, band `<10`, no top assets, and the backend verifier config accepts the signed result
- [x] 3.4 Shipped directly to the deploy branches (2026-10-12, no PRs): backend `main` `4efa40a` → `75d3bbf` (merge of tier-0 + bot/group-rooms/charts), frontend `main-v2` `d09475c` → `fbd20d3` (tier-0 only; unrelated in-progress work left uncommitted in the tree)