# Proposal: TIER 0 admission (proven floor for wallets below $100k)

## Why

Tier 0 has existed in the tier math since the beginning ("below the first
threshold") but the product treats it as "not admitted": `productTierLabel(0)`
returns null, the backend writes no eligibility row, and every room / play gate
reads the holder as unverified. The result is that a wallet set which proves
perfectly but totals below $100k is locked out of the app — even though its
ownership proof, nullifiers, and attestation are exactly as strong as anyone
else's.

The bot work on the backend rail worked around this by setting the TIER I
threshold to $0 (`2c88438`), which admits everyone as TIER I and erases the
$100k bar entirely. That is the wrong fix: tier I rooms currently admit $0
wallets, and the landing strip advertises "TIER I from $0".

## What changes

- **MODIFY** tier 0 semantics from "not admitted" to "admitted floor": a
  proven wallet set below $100k receives TIER 0, is served as verified, and can
  use the app at the lowest access level. Tiers I–IV keep gating their rooms
  with the existing rank comparison.
- **MODIFY** `TIERS` / `DEV_TIERS` id-0 label from `"none"` to `"$0+"`, so the
  signed label matches the `$N+` pattern of its siblings.
- **MODIFY** `productTierLabel`: 0 → `"0"` (product label `TIER 0`); negative
  and unknown ids still fail closed to null.
- **MODIFY** the tier-0 portfolio band to follow the active tier set
  (`<100k` prod, `<10` dev) instead of the hard-coded `<100k`.
- **BUMP** `POLICY_VERSION` (`6figs-tee-2026-10-e` → `6figs-tee-2026-10-f`):
  the signed body's label and band strings change, so a mixed fleet must fail
  closed at the verifier rather than serve divergent labels.
- Backend: the eligibility cache carries a `TIER 0` row (every admitted tier
  gets a row), the stored view serves tier 0 as verified, subset wallet login
  and re-prove work for tier-0 accounts, `VALID_TIERS` includes `TIER 0`, and
  the bot-rail tier hack (TIER I at $0) is dropped.
- Frontend: `TIER 0` joins the tier ladder with its own plain edge (`t0`), the
  landing strip shows five assay cells, room create offers `TIER 0` as a
  minimum for tier-0 holders, and docs say "five tiers; every proven wallet is
  a member".

## What does not change

- Thresholds for I–IV and lower-bound assignment; a Tier II badge still means
  "at least $300k".
- Privacy invariants: no new stored fields, no new logs, tier facts only.
- Room gating math: `tierRank` comparisons are untouched; a TIER 0 room admits
  every verified wallet and tiers I–IV still exclude holders beneath them.
- The verifier's accepted tier range (0..4); the change is what the *product*
  derives from id 0, not what the enclave may sign.

## Non-goals

- Finer bands inside tier 0 (it stays the single `<100k` band).
- Any change to nullifiers, escrow, ownership challenges, or transitions.
- Retroactively correcting historical TIER I-at-$0 rows created by the bot
  rail; existing `EligibilityCache` rows are re-derived on the holder's next
  registration or recheck.