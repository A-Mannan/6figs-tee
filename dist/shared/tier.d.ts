import { type AllocationCategory, type TierDefinition } from "./constants.ts";
import type { AllocationEntry } from "./types.ts";
/** Maximum price we will accept for a single unit, in micro-USD. */
export declare const MAX_PRICE_MICRO: bigint;
/** Balances above this reading are treated as garbage and skipped. */
export declare const MAX_BALANCE: bigint;
/**
 * value = balance * price / 10^decimals, integer division, with overflow guard.
 * Returns null when the inputs are out of range or the product could overflow,
 * so a malformed RPC answer is skipped rather than corrupting the total.
 */
export declare function valueMicroUsd(balanceRaw: bigint, priceMicroUsd: bigint, decimals: number): bigint | null;
/** Highest tier whose minimum the total meets. */
export declare function assignTier(totalMicroUsd: bigint, tiers?: readonly TierDefinition[]): TierDefinition;
export declare function nextTierFloor(tierId: number, tiers?: readonly TierDefinition[]): bigint;
/** Coarse band string. Never reveals the exact total. */
export declare function portfolioBand(totalMicroUsd: bigint, tiers?: readonly TierDefinition[]): string;
/**
 * Canonical asset symbol for disclosure. Symbols come from untrusted token
 * contracts, so they are uppercased, stripped to A-Z0-9, and truncated; an
 * empty result means the asset is skipped rather than shown as a spoof.
 */
export declare function sanitizeAssetSymbol(raw: string): string | null;
/** Wallet app label (e.g. "Phantom") attached to a binding; printable ASCII. */
export declare function sanitizeWalletLabel(raw: string): string | null;
export interface ValuedHolding {
    symbol: string;
    valueMicroUsd: bigint;
}
/**
 * Up to `max` disclosed symbols ordered by value, each holding at least
 * `minBps` of the total. Amounts never leave this function.
 */
export declare function topAssetSymbols(holdings: readonly ValuedHolding[], totalMicroUsd: bigint, options?: {
    minBps?: number;
    max?: number;
}): string[];
export interface CategorizedPosition {
    category: AllocationCategory;
    valueMicroUsd: bigint;
}
/**
 * Category split in basis points. Basis points always sum to 10000 when the
 * total is positive, using largest-remainder rounding on the final category.
 */
export declare function computeAllocation(positions: CategorizedPosition[]): {
    allocation: AllocationEntry[];
    totalMicroUsd: bigint;
};
