# Spec Delta

## Purpose

Tier 0 becomes an admitted tier: tee tier id 0 maps to product label `0`
(`TIER 0`), verified wallets below the first threshold are served as members at
the lowest access level, and the four six-figure tiers keep gating their rooms
exactly as before.

## RENAMED Requirements

- FROM: `### Requirement: Four-tier identity mapping`
- TO: `### Requirement: Five-tier identity mapping`

## MODIFIED Requirements

### Requirement: Five-tier identity mapping

The system SHALL map tee tier ids 0–4 to product labels 0, I–IV one-to-one and
SHALL expose the mapping as a shared helper used identically by frontend
display and backend gating. Tier 0 SHALL be an admitted tier: a proven wallet
set below the first threshold receives it, is served as verified, and is
admitted at the lowest access level; tier I–IV rooms still exclude holders
beneath their minimum.

#### Scenario: Consistent labels
- **WHEN** either app maps a tee tier id
- **THEN** it resolves through the shared helper to the same product label (0→0, 1→I, 2→II, 3→III, 4→IV)

#### Scenario: Tier 0 admitted
- **WHEN** a verified wallet set totals below the first threshold
- **THEN** the signed result carries tier id 0 with label `$0+`, the backend stores an eligibility row labeled `TIER 0`, and the holder can use the app at the lowest access level

#### Scenario: Higher tiers still gate
- **WHEN** a TIER 0 holder attempts a TIER I–IV room
- **THEN** the existing rank gate rejects entry and names the room's minimum

#### Scenario: Unverified ids
- **WHEN** the tier id is negative or above 4
- **THEN** the helper returns no label and gating denies access