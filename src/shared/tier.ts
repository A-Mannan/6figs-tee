import {
  ALLOCATION_CATEGORIES,
  TIERS,
  VALUE_SCALE,
  type AllocationCategory,
  type TierDefinition,
} from "./constants.ts";
import type { AllocationEntry } from "./types.ts";

/** Maximum price we will accept for a single unit, in micro-USD. */
export const MAX_PRICE_MICRO = 100_000_000n * VALUE_SCALE; // $100M/unit

/** Balances above this reading are treated as garbage and skipped. */
export const MAX_BALANCE = 1n << 96n;

/**
 * value = balance * price / 10^decimals, integer division, with overflow guard.
 * Returns null when the inputs are out of range or the product could overflow,
 * so a malformed RPC answer is skipped rather than corrupting the total.
 */
export function valueMicroUsd(
  balanceRaw: bigint,
  priceMicroUsd: bigint,
  decimals: number,
): bigint | null {
  if (balanceRaw < 0n || priceMicroUsd < 0n) return null;
  if (balanceRaw >= MAX_BALANCE) return null;
  if (priceMicroUsd > MAX_PRICE_MICRO) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const divisor = 10n ** BigInt(decimals);
  return (balanceRaw * priceMicroUsd) / divisor;
}

/** Highest tier whose minimum the total meets. */
export function assignTier(totalMicroUsd: bigint): TierDefinition {
  let selected = TIERS[0]!;
  for (const tier of TIERS) {
    if (totalMicroUsd >= tier.minMicroUsd) selected = tier;
  }
  return selected;
}

export function nextTierFloor(tierId: number): bigint {
  const next = TIERS.find((t) => t.id === tierId + 1);
  return next ? next.minMicroUsd : 0n;
}

/** Coarse band string. Never reveals the exact total. */
export function portfolioBand(totalMicroUsd: bigint): string {
  const band = assignTier(totalMicroUsd);
  if (band.id === 0) return "<100k";
  const next = nextTierFloor(band.id);
  if (next === 0n) return "1m+";
  return `${short(band.minMicroUsd)}-${short(next)}`;
}

function short(microUsd: bigint): string {
  const dollars = microUsd / VALUE_SCALE;
  if (dollars >= 1_000_000n) return `${dollars / 1_000_000n}m`;
  if (dollars >= 1_000n) return `${dollars / 1_000n}k`;
  return dollars.toString();
}

export interface CategorizedPosition {
  category: AllocationCategory;
  valueMicroUsd: bigint;
}

/**
 * Category split in basis points. Basis points always sum to 10000 when the
 * total is positive, using largest-remainder rounding on the final category.
 */
export function computeAllocation(positions: CategorizedPosition[]): {
  allocation: AllocationEntry[];
  stableBps: number;
  totalMicroUsd: bigint;
} {
  let total = 0n;
  const byCategory = new Map<AllocationCategory, bigint>();
  for (const category of ALLOCATION_CATEGORIES) byCategory.set(category, 0n);

  for (const position of positions) {
    if (position.valueMicroUsd <= 0n) continue;
    total += position.valueMicroUsd;
    byCategory.set(
      position.category,
      (byCategory.get(position.category) ?? 0n) + position.valueMicroUsd,
    );
  }

  if (total === 0n) {
    return {
      allocation: ALLOCATION_CATEGORIES.map((category) => ({ category, bps: 0 })),
      stableBps: 0,
      totalMicroUsd: 0n,
    };
  }

  const allocation: AllocationEntry[] = [];
  let assigned = 0;
  for (const category of ALLOCATION_CATEGORIES) {
    const value = byCategory.get(category) ?? 0n;
    const bps = Number((value * 10_000n) / total);
    assigned += bps;
    allocation.push({ category, bps });
  }

  // Give the rounding remainder to the largest category so the sum is 10000.
  const remainder = 10_000 - assigned;
  if (remainder !== 0) {
    let largestIndex = 0;
    for (let i = 1; i < allocation.length; i++) {
      if ((byCategory.get(allocation[i]!.category) ?? 0n) > (byCategory.get(allocation[largestIndex]!.category) ?? 0n)) {
        largestIndex = i;
      }
    }
    allocation[largestIndex]!.bps += remainder;
  }

  const stableBps = allocation.find((a) => a.category === "stable")?.bps ?? 0;
  return { allocation, stableBps, totalMicroUsd: total };
}