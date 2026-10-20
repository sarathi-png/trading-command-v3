import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatAge,
  formatClock,
  formatMoney,
  formatNumber,
  formatPct,
  formatPrice,
  formatQty,
  formatSignedMoney,
  priceDigits,
  stalenessLabel,
} from "../src/lib/format";

const NOW = Date.parse("2026-10-20T12:00:00.000Z");

describe("formatting", () => {
  it("never renders a missing number as zero", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(formatPrice(value), "unavailable");
      assert.equal(formatMoney(value), "unavailable");
      assert.equal(formatPct(value), "unavailable");
      assert.equal(formatQty(value), "unavailable");
      assert.equal(formatNumber(value), "unavailable");
    }
  });

  it("groups thousands and formats prices adaptively", () => {
    assert.equal(formatNumber(1234567.891), "1,234,567.89");
    assert.equal(formatPrice(108000.5), "108,000.50");
    assert.equal(formatPrice(0.5), "0.5000");
    assert.equal(formatPrice(0.0001234), "0.000123");
    assert.equal(priceDigits(2), 2);
    assert.equal(priceDigits(0.2), 4);
    assert.equal(priceDigits(0.002), 6);
  });

  it("puts the sign in front of the currency symbol", () => {
    assert.equal(formatMoney(1234.5), "$1,234.50");
    assert.equal(formatMoney(-1234.5), "-$1,234.50");
    assert.equal(formatMoney(1000, "inr", 0), "₹1,000");
    assert.equal(formatSignedMoney(12.5), "+$12.50");
    assert.equal(formatSignedMoney(-12.5), "-$12.50");
    assert.equal(formatSignedMoney(0), "$0.00");
    assert.equal(formatNumber(-0.001), "0.00");
    assert.equal(formatPct(-0.001), "0.00%");
  });

  it("signs percentages and trims quantities", () => {
    assert.equal(formatPct(1.239), "+1.24%");
    assert.equal(formatPct(-0.5), "-0.50%");
    assert.equal(formatQty(0.5), "0.5");
    assert.equal(formatQty(1), "1");
  });

  it("describes age from a real timestamp only", () => {
    assert.equal(formatAge(null, NOW), "unavailable");
    assert.equal(formatAge("not-a-date", NOW), "unavailable");
    assert.equal(formatAge("2026-10-20T11:59:30.000Z", NOW), "just now");
    assert.equal(formatAge("2026-10-20T11:55:00.000Z", NOW), "5m ago");
    assert.equal(formatAge("2026-10-20T09:00:00.000Z", NOW), "3h ago");
    assert.equal(formatAge("2026-10-18T12:00:00.000Z", NOW), "2d ago");
  });

  it("labels freshness honestly", () => {
    assert.equal(stalenessLabel(undefined, null, NOW), "AS OF UNAVAILABLE");
    assert.equal(stalenessLabel(true, "2026-10-20T11:55:00.000Z", NOW), "STALE · 5m ago");
    assert.equal(stalenessLabel(false, "2026-10-20T11:55:00.000Z", NOW), "FRESH · 5m ago");
  });

  it("shows the provider timestamp as a UTC clock", () => {
    assert.equal(formatClock("2026-10-20T12:03:04.000Z"), "12:03:04 UTC");
    assert.equal(formatClock(null), "unavailable");
    assert.equal(formatClock("nope"), "unavailable");
  });
});
