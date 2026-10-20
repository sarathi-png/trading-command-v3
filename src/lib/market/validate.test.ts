import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isValidCandle, validateCandles } from "./validate";
import type { Candle } from "../types";

const bar = (over: Partial<Candle> = {}): Candle => ({
  time: 1_700_000_000,
  open: 100,
  high: 110,
  low: 90,
  close: 105,
  volume: 12,
  ...over,
});

describe("isValidCandle", () => {
  it("accepts a normal bar", () => {
    assert.equal(isValidCandle(bar()), true);
  });

  it("rejects non-finite values", () => {
    assert.equal(isValidCandle(bar({ close: Number.NaN })), false);
    assert.equal(isValidCandle(bar({ high: Number.POSITIVE_INFINITY })), false);
  });

  it("rejects impossible OHLC relationships", () => {
    assert.equal(isValidCandle(bar({ high: 80 })), false);
    assert.equal(isValidCandle(bar({ low: 120 })), false);
    assert.equal(isValidCandle(bar({ high: 90, low: 95 })), false);
  });

  it("rejects negative volume and non-positive time", () => {
    assert.equal(isValidCandle(bar({ volume: -1 })), false);
    assert.equal(isValidCandle(bar({ time: 0 })), false);
  });
});

describe("validateCandles", () => {
  const now = 1_700_000_000_000;

  it("sorts ascending and removes duplicate timestamps", () => {
    const result = validateCandles(
      [bar({ time: 1_699_999_700, close: 101 }), bar({ time: 1_699_999_600 }), bar({ time: 1_699_999_700, close: 102 })],
      { nowMs: now }
    );
    assert.deepEqual(result.candles.map((c) => c.time), [1_699_999_600, 1_699_999_700]);
    assert.equal(result.candles[1].close, 102, "last duplicate wins");
    assert.equal(result.rejected, 1);
  });

  it("drops invalid bars and counts them", () => {
    const result = validateCandles([bar({ time: 1_699_999_600 }), bar({ time: 1_699_999_700, high: 1 })], {
      nowMs: now,
    });
    assert.equal(result.candles.length, 1);
    assert.equal(result.rejected, 1);
  });

  it("rejects bars too far in the future", () => {
    const result = validateCandles([bar({ time: Math.floor(now / 1000) + 3600 })], {
      nowMs: now,
      timeframeSeconds: 900,
    });
    assert.equal(result.candles.length, 0);
    assert.equal(result.rejected, 1);
  });

  it("allows the in-progress bar", () => {
    const result = validateCandles([bar({ time: Math.floor(now / 1000) })], {
      nowMs: now,
      timeframeSeconds: 900,
    });
    assert.equal(result.candles.length, 1);
  });

  it("returns an empty result for empty input", () => {
    assert.deepEqual(validateCandles([]), { candles: [], rejected: 0 });
  });
});
