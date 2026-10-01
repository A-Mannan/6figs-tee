import { test } from "node:test";
import assert from "node:assert/strict";
import { DEV_TIERS } from "../src/shared/constants.ts";
import {
  assignTier,
  computeAllocation,
  nextTierFloor,
  portfolioBand,
  topAssetSymbols,
  valueMicroUsd,
} from "../src/shared/tier.ts";

const USD = 1_000_000n;

test("valueMicroUsd applies decimals correctly", () => {
  // 1.5 ETH (18 decimals) at $2000 => 3_000_000_000 micro-USD ($3000)
  const value = valueMicroUsd(1_500_000_000_000_000_000n, 2_000n * USD, 18);
  assert.equal(value, 3_000n * USD);
});

test("valueMicroUsd rejects overflows and garbage", () => {
  assert.equal(valueMicroUsd(1n << 97n, 1n, 0), null);
  assert.equal(valueMicroUsd(1n, 200_000_000n * USD, 0), null);
  assert.equal(valueMicroUsd(-1n, 1n, 0), null);
  assert.equal(valueMicroUsd(1n, 1n, 99), null);
});

test("assignTier picks the highest band met", () => {
  assert.equal(assignTier(50_000n * USD).id, 0);
  assert.equal(assignTier(100_000n * USD).id, 1);
  assert.equal(assignTier(299_999n * USD).id, 1);
  assert.equal(assignTier(300_000n * USD).id, 2);
  assert.equal(assignTier(499_999n * USD).id, 2);
  assert.equal(assignTier(500_000n * USD).id, 3);
  assert.equal(assignTier(1_000_000n * USD).id, 4);
  assert.equal(assignTier(50_000_000n * USD).id, 4);
});

test("nextTierFloor exposes the next bound", () => {
  assert.equal(nextTierFloor(1), 300_000n * USD);
  assert.equal(nextTierFloor(4), 0n);
});

test("dev tiers mirror the product devnet thresholds", () => {
  assert.equal(assignTier(9n * USD, DEV_TIERS).id, 0);
  assert.equal(assignTier(10n * USD, DEV_TIERS).id, 1);
  assert.equal(assignTier(99n * USD, DEV_TIERS).id, 1);
  assert.equal(assignTier(100n * USD, DEV_TIERS).id, 2);
  assert.equal(assignTier(500n * USD, DEV_TIERS).id, 3);
  assert.equal(assignTier(1_000n * USD, DEV_TIERS).id, 4);
  assert.equal(portfolioBand(250n * USD, DEV_TIERS), "100-500");
  assert.equal(nextTierFloor(1, DEV_TIERS), 100n * USD);
});

test("topAssetSymbols discloses at most three symbols above the share floor", () => {
  const total = 1_000n * USD;
  const holdings = [
    { symbol: "eth", valueMicroUsd: 600n * USD },
    { symbol: "SOL", valueMicroUsd: 300n * USD },
    { symbol: "usdc", valueMicroUsd: 60n * USD },
    { symbol: "dust", valueMicroUsd: 10n * USD },
    { symbol: "😀", valueMicroUsd: 30n * USD },
  ];
  assert.deepEqual(topAssetSymbols(holdings, total), ["ETH", "SOL", "USDC"]);
});

test("topAssetSymbols caps at three, dedupes by symbol, and handles zero", () => {
  const total = 100n * USD;
  const holdings = ["A", "B", "C", "D"].map((symbol) => ({
    symbol,
    valueMicroUsd: 25n * USD,
  }));
  assert.deepEqual(topAssetSymbols(holdings, total), ["A", "B", "C"]);
  assert.deepEqual(
    topAssetSymbols(
      [
        { symbol: "eth", valueMicroUsd: 40n * USD },
        { symbol: "ETH", valueMicroUsd: 40n * USD },
      ],
      100n * USD,
    ),
    ["ETH"],
  );
  assert.deepEqual(topAssetSymbols([], 0n), []);
});

test("portfolioBand is coarse", () => {
  assert.equal(portfolioBand(42_424n * USD), "<100k");
  assert.equal(portfolioBand(123_456n * USD), "100k-300k");
  assert.equal(portfolioBand(999_999n * USD), "500k-1m");
  assert.equal(portfolioBand(2_000_000n * USD), "1m+");
});

test("allocation sums to 10000 bps", () => {
  const { allocation, totalMicroUsd, stableBps } = computeAllocation([
    { category: "stable", valueMicroUsd: 50_000n * USD },
    { category: "majors", valueMicroUsd: 30_000n * USD },
    { category: "altcoins", valueMicroUsd: 20_000n * USD },
  ]);
  assert.equal(totalMicroUsd, 100_000n * USD);
  assert.equal(stableBps, 5000);
  assert.equal(
    allocation.reduce((sum, entry) => sum + entry.bps, 0),
    10_000,
  );
});

test("allocation handles an empty portfolio", () => {
  const { allocation, stableBps, totalMicroUsd } = computeAllocation([]);
  assert.equal(totalMicroUsd, 0n);
  assert.equal(stableBps, 0);
  assert.equal(allocation.reduce((s, e) => s + e.bps, 0), 0);
});