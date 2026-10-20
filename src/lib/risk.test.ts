import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeRiskLimits } from "./risk";

describe("normalizeRiskLimits", () => {
  it("keeps sane values", () => {
    assert.deepEqual(normalizeRiskLimits({ maxDailyLoss: 200, maxOrderValue: 5000, maxLeverage: 10, maxOpenPositions: 4 }), {
      maxDailyLoss: 200,
      maxOrderValue: 5000,
      maxLeverage: 10,
      maxOpenPositions: 4,
    });
  });

  it("clamps absurd order values", () => {
    assert.equal(normalizeRiskLimits({ maxOrderValue: 1e12 }).maxOrderValue, 1_000_000);
  });

  it("never lets the daily-loss cap exceed the per-order cap", () => {
    assert.equal(normalizeRiskLimits({ maxOrderValue: 100, maxDailyLoss: 50_000 }).maxDailyLoss, 100);
  });

  it("replaces non-finite and non-positive values with fallbacks", () => {
    const limits = normalizeRiskLimits({
      maxDailyLoss: Number.NaN,
      maxOrderValue: Number.POSITIVE_INFINITY,
      maxLeverage: -3,
      maxOpenPositions: 0,
    });
    assert.equal(limits.maxDailyLoss, 200);
    assert.equal(limits.maxOrderValue, 5000);
    assert.equal(limits.maxLeverage, 10);
    assert.equal(limits.maxOpenPositions, 4); // falls back to the default, then clamps
  });
});
