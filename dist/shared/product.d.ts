/**
 * Tee tier ids map one-to-one onto the product's four tiers: 1→I ($100k),
 * 2→II ($300k), 3→III ($500k), 4→IV ($1M). Tee tier 0 (below $100k) and any
 * unknown id map to null: no label, no room access. Unknown ids fail closed so
 * a future tier never silently inherits a label it was not assigned.
 */
export type ProductTierLabel = "I" | "II" | "III" | "IV";
export declare function productTierLabel(teeTierId: number): ProductTierLabel | null;
