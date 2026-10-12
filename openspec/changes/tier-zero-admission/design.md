# Design: TIER 0 admission

## Context

Making tier 0 admitted touches three trust boundaries that have to move
together:

1. **The signed body.** The enclave labels id 0 `"none"` and bands it `<100k`.
   Both strings are inside the signed result, so any consumer that cached,
   pinned, or compared them sees different bytes the moment the semantics
   change.
2. **The backend's admission proxy.** Every gate (rooms, play, the verified
   directory) reads the `EligibilityCache` row: presence = "verified", `tier`
   = "how gated". `syncEligibilityCache` previously *deleted* the row for
   tier 0, which was the admission switch for "did not clear the bar".
3. **The frontend ladder.** `TIER_ORDER` had four rungs; `tierRank` was
   1-based with unknown → 0, so a fifth rung could not be inserted without
   renumbering.

## Decisions

### 1. Label `$0+`, product label `0`

The tee keeps lower-bound semantics and names id 0 `$0+` (dev `$0+` as well:
every dev threshold is dollar-scaled). The product label is the string `"0"`,
displayed as `TIER 0`. Rationale: the label pattern stays uniform (`$N+`),
`productTierLabel` stays a total, closed mapping (0..4 → 0,I..IV; anything
else → null), and existing verifiers already accept tier id 0 — only the
mapping's meaning changes.

### 2. Admission is the eligibility-cache row

No new gate logic. `syncEligibilityCache` now upserts for every tier id
including 0 (writes stop only when the identity is wiped). Rooms and play
already compare `tierRank(holder)` against `tierRank(minimum)`: with
`TIER 0 → 0` and `TIER I → 1`, a tier-0 holder passes every "is verified"
check and fails every "needs TIER I+" check — exactly "admitted at the lowest
access level". `tierRank` becomes 0-based with unknown → −1 so an unverified
value can never outrank the floor.

### 3. Room minimums include `TIER 0`

`VALID_TIERS` gains `TIER 0`, so a creator can set a table open to every
verified wallet. The existing "cannot require above your own tier" rule keeps
tier-0 creators to TIER 0 rooms; higher-tier creators may offer TIER 0 as a
deliberately open table.

### 4. Login and re-prove semantics unify

`registerLogin`'s subset shortcut and the establish path's re-prove coherence
escape were keyed to `tier !== 0` / `tier === 0` because 0 meant "zeroed by
the old disconnect flow". With 0 now a normal verified state:

- Subset wallet login applies to every stored identity (a tier-0 holder with
  one wallet of a two-wallet set can sign in) — same as any other tier.
- The establish-path escape stays keyed to tier 0 but now reads as *legacy*:
  it only triggers when the stored bindings no longer match the stored
  identity (rows left over from the old disconnect flow, which could only
  ever be zeroed accounts). Coherent sets — every newly admitted tier-0
  account included — never reach the branch, so no silent set shrinkage is
  possible.

### 5. Band strings stay coarse

Tier 0's band follows the active tier set: `<100k` in production, `<10` under
`SIXFIGS_DEV_CHAINS=1`. Never a number, same disclosure level as before.

### 6. POLICY_VERSION bump and rollout order

The bump (`-e` → `-f`) makes mixed fleets fail closed: the verifier compares
`SIXFIGS_EXPECTED_POLICY_VERSION` (or the packaged default) against the signed
body. Rollout: cut the tee tag → bump both app pins → set the backend's
expected policy version → rebuild the enclave image and pin the new digest.
The enclave may land last; old backends reject new results, never mis-serve
them, and the browser refuses before sending anything if digests differ.

## Risks / tradeoffs

- **Positioning.** The docs no longer say "under $100K, not admitted"; the
  landing strip shows five cells with the plain `t0` edge. Room-gated status
  is preserved by the tier gates themselves.
- **The bot rail's TIER I-at-$0 hack** must be dropped when the bot commit
  (`2c88438`, backend) meets this change: TIER I returns to $100k and the bot
  is simply an opponent with no tier exposure (`pubUser(bot, null)`).
- **Historical rows.** Eligibility rows written by the hacked thresholds say
  "TIER I" for sub-$100k holders; they are refreshed on the next registration,
  recheck, or TTL expiry. No migration is needed because tier facts are
  re-derived, not stored history.