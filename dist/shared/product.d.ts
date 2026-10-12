/**
 * Tee tier ids map onto the product's five tiers: 0→0 (TIER 0, below $100k,
 * admitted with lowest access), 1→I ($100k), 2→II ($300k), 3→III ($500k),
 * 4→IV ($1M). Unknown ids map to null: no label, no room access. Unknown ids
 * fail closed so a future tier never silently inherits a label it was not
 * assigned.
 */
export type ProductTierLabel = "0" | "I" | "II" | "III" | "IV";
export declare function productTierLabel(teeTierId: number): ProductTierLabel | null;
