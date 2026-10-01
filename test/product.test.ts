import { test } from "node:test";
import assert from "node:assert/strict";
import { productTierLabel } from "../src/shared/product.ts";

test("productTierLabel maps tee tiers to product labels", () => {
  assert.equal(productTierLabel(0), null);
  assert.equal(productTierLabel(1), "I");
  assert.equal(productTierLabel(2), "II");
  assert.equal(productTierLabel(3), "II");
  assert.equal(productTierLabel(4), "III");
});

test("productTierLabel fails closed on unknown ids", () => {
  assert.equal(productTierLabel(-1), null);
  assert.equal(productTierLabel(5), null);
  assert.equal(productTierLabel(Number.NaN), null);
});
