/**
 * Tee tier id (0–4) to product tier label. The 6FIGS app gates rooms on three
 * labels — TIER I/II/III at $100K/$500K/$1M — while the tee proves four
 * lower-bound tiers ($100K/$300K/$500K/$1M), so the middle two tee tiers share
 * one product label. Tee tier 0 (below $100K) and any unknown id map to null:
 * no label, no room access. Unknown ids fail closed so a future tier never
 * silently inherits a label it was not assigned.
 */
export type ProductTierLabel = "I" | "II" | "III";

export function productTierLabel(teeTierId: number): ProductTierLabel | null {
  if (teeTierId === 1) return "I";
  if (teeTierId === 2 || teeTierId === 3) return "II";
  if (teeTierId === 4) return "III";
  return null;
}
