# Tasks: tier-zero-admission

> Resume here. Tee-side code and both app working trees carry the change and are
> verified locally; what remains is the release rail (tag + dist, dep pins,
> image rebuild, PRs). App work goes on feature branches only — never push to
> `main` of `6FIGS.XYZ_backend` or `6FIGS.XYZ_frontend`. Note for the merge:
> the backend bot commit (`2c88438`, on `origin/main`) sets the TIER I
> threshold to $0 as a workaround; this change supersedes it — TIER I returns
> to $100k and tier 0 carries the floor.

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
- [ ] 1.6 Bump the `@sixfigs/tee` dep to the new release tag + install (after 3.1)
- [ ] 1.7 Reconcile with the bot rail on `origin/main`: drop the TIER I-at-$0 threshold hack, keep this change's thresholds, merge the bot copy into the branch that ships

## 2. Frontend (`6FIGS.XYZ_frontend`, current branch)

- [x] 2.1 `TIER_ORDER` + `tierRank` include TIER 0 (0-based); `tierEdgeClass("TIER 0") → t0` with CSS for the tag and the assay cell; landing strip is five columns
- [x] 2.2 Create page offers TIER 0 for tier-0 holders and snaps the default within their ceiling; rooms filter adds "Tier 0 only"
- [x] 2.3 Play copy: "prove your wallets" replaces the tier-bar framing; docs ladder and band diagram describe five tiers
- [x] 2.4 Verified: `npm run typecheck` + `npm run lint` green (no frontend test runner exists)
- [ ] 2.5 Bump the `@sixfigs/tee` dep to the new release tag + install (after 3.1)

## 3. Release and rollout

- [ ] 3.1 Tee release: `npm run build`, `git add -f dist`, commit, tag, push (process in `docs/INTEGRATION.md`)
- [ ] 3.2 Rebuild the enclave image under `6figs-tee-2026-10-f`; pin the new digest in backend `SIXFIGS_IMAGE_DIGEST` and the frontend enclave policy; roll the VM (image-rotation runbook)
- [ ] 3.3 Regenerate a tier-0 proof against the dev enclave end-to-end (login → profile shows `TIER 0` → take a seat → room create offers TIER 0), as the browser-level verification
- [ ] 3.4 PRs for both app branches: state tier-0 admission, the policy-version bump, and the room-gating semantics (base `main`, head the working branch)