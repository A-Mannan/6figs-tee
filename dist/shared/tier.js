import { ALLOCATION_CATEGORIES, MAX_TOP_ASSETS, MAX_WALLET_LABEL, TIERS, TOP_ASSETS_MIN_BPS, VALUE_SCALE, } from "./constants.js";
/** Maximum price we will accept for a single unit, in micro-USD. */
export const MAX_PRICE_MICRO = 100000000n * VALUE_SCALE; // $100M/unit
/** Balances above this reading are treated as garbage and skipped. */
export const MAX_BALANCE = 1n << 96n;
/**
 * value = balance * price / 10^decimals, integer division, with overflow guard.
 * Returns null when the inputs are out of range or the product could overflow,
 * so a malformed RPC answer is skipped rather than corrupting the total.
 */
export function valueMicroUsd(balanceRaw, priceMicroUsd, decimals) {
    if (balanceRaw < 0n || priceMicroUsd < 0n)
        return null;
    if (balanceRaw >= MAX_BALANCE)
        return null;
    if (priceMicroUsd > MAX_PRICE_MICRO)
        return null;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
        return null;
    const divisor = 10n ** BigInt(decimals);
    return (balanceRaw * priceMicroUsd) / divisor;
}
/** Highest tier whose minimum the total meets. */
export function assignTier(totalMicroUsd, tiers = TIERS) {
    let selected = tiers[0];
    for (const tier of tiers) {
        if (totalMicroUsd >= tier.minMicroUsd)
            selected = tier;
    }
    return selected;
}
export function nextTierFloor(tierId, tiers = TIERS) {
    const next = tiers.find((t) => t.id === tierId + 1);
    return next ? next.minMicroUsd : 0n;
}
/** Coarse band string. Never reveals the exact total. */
export function portfolioBand(totalMicroUsd, tiers = TIERS) {
    const band = assignTier(totalMicroUsd, tiers);
    if (band.id === 0)
        return "<100k";
    const next = nextTierFloor(band.id, tiers);
    if (next === 0n)
        return "1m+";
    return `${short(band.minMicroUsd)}-${short(next)}`;
}
/**
 * Canonical asset symbol for disclosure. Symbols come from untrusted token
 * contracts, so they are uppercased, stripped to A-Z0-9, and truncated; an
 * empty result means the asset is skipped rather than shown as a spoof.
 */
export function sanitizeAssetSymbol(raw) {
    const cleaned = raw
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 10);
    return cleaned.length > 0 ? cleaned : null;
}
/** Wallet app label (e.g. "Phantom") attached to a binding; printable ASCII. */
export function sanitizeWalletLabel(raw) {
    const cleaned = raw
        .replace(/[^\x20-\x7E]/g, "")
        .trim()
        .slice(0, MAX_WALLET_LABEL);
    return cleaned.length > 0 ? cleaned : null;
}
/**
 * Up to `max` disclosed symbols ordered by value, each holding at least
 * `minBps` of the total. Amounts never leave this function.
 */
export function topAssetSymbols(holdings, totalMicroUsd, options = {}) {
    const minBps = options.minBps ?? TOP_ASSETS_MIN_BPS;
    const max = options.max ?? MAX_TOP_ASSETS;
    if (totalMicroUsd <= 0n)
        return [];
    const bySymbol = new Map();
    for (const holding of holdings) {
        if (holding.valueMicroUsd <= 0n)
            continue;
        const symbol = sanitizeAssetSymbol(holding.symbol);
        if (!symbol)
            continue;
        bySymbol.set(symbol, (bySymbol.get(symbol) ?? 0n) + holding.valueMicroUsd);
    }
    return [...bySymbol.entries()]
        .filter(([, value]) => value * 10000n >= totalMicroUsd * BigInt(minBps))
        .sort((a, b) => {
        if (a[1] !== b[1])
            return a[1] > b[1] ? -1 : 1;
        return a[0] < b[0] ? -1 : 1;
    })
        .slice(0, max)
        .map(([symbol]) => symbol);
}
function short(microUsd) {
    const dollars = microUsd / VALUE_SCALE;
    if (dollars >= 1000000n)
        return `${dollars / 1000000n}m`;
    if (dollars >= 1000n)
        return `${dollars / 1000n}k`;
    return dollars.toString();
}
/**
 * Category split in basis points. Basis points always sum to 10000 when the
 * total is positive, using largest-remainder rounding on the final category.
 */
export function computeAllocation(positions) {
    let total = 0n;
    const byCategory = new Map();
    for (const category of ALLOCATION_CATEGORIES)
        byCategory.set(category, 0n);
    for (const position of positions) {
        if (position.valueMicroUsd <= 0n)
            continue;
        total += position.valueMicroUsd;
        byCategory.set(position.category, (byCategory.get(position.category) ?? 0n) + position.valueMicroUsd);
    }
    if (total === 0n) {
        return {
            allocation: ALLOCATION_CATEGORIES.map((category) => ({ category, bps: 0 })),
            totalMicroUsd: 0n,
        };
    }
    const allocation = [];
    let assigned = 0;
    for (const category of ALLOCATION_CATEGORIES) {
        const value = byCategory.get(category) ?? 0n;
        const bps = Number((value * 10000n) / total);
        assigned += bps;
        allocation.push({ category, bps });
    }
    // Give the rounding remainder to the largest category so the sum is 10000.
    const remainder = 10_000 - assigned;
    if (remainder !== 0) {
        let largestIndex = 0;
        for (let i = 1; i < allocation.length; i++) {
            if ((byCategory.get(allocation[i].category) ?? 0n) > (byCategory.get(allocation[largestIndex].category) ?? 0n)) {
                largestIndex = i;
            }
        }
        allocation[largestIndex].bps += remainder;
    }
    return { allocation, totalMicroUsd: total };
}
