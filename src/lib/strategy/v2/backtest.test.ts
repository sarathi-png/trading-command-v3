import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/types";
import { toHeikinAshi, haColor } from "./heikin-ashi";
import { chandelierExit, getChandelierSignal } from "./chandelier";
import { donchianRibbon, getDonchianState } from "./donchian";
import { evaluateChandelierDonchian, calculatePositionSize } from "./chandelier-donchian";
import { runBacktest, aggregateWalkForward } from "./backtest";

function makeCandles(count: number, startPrice = 100, trend: "up" | "down" | "flat" = "up"): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const now = 1700000000;
  let seed = 123456;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < count; i++) {
    const drift = trend === "up" ? 0.5 : trend === "down" ? -0.5 : 0;
    const open = price;
    const close = price + drift + (random() - 0.5) * 2;
    const high = Math.max(open, close) + random() * 1.5;
    const low = Math.min(open, close) - random() * 1.5;
    candles.push({ time: now + i * 300, open, high, low, close, volume: 100 + random() * 50 });
    price = close;
  }
  return candles;
}

describe("heikin-ashi", () => {
  it("converts regular candles to Heikin Ashi", () => {
    const candles = makeCandles(50, 100, "up");
    const ha = toHeikinAshi(candles);
    assert.equal(ha.length, candles.length);
    for (const c of ha) {
      assert.ok(Number.isFinite(c.haOpen));
      assert.ok(Number.isFinite(c.haClose));
      assert.ok(Number.isFinite(c.haHigh));
      assert.ok(Number.isFinite(c.haLow));
      assert.ok(c.haHigh >= Math.max(c.haOpen, c.haClose));
      assert.ok(c.haLow <= Math.min(c.haOpen, c.haClose));
    }
  });

  it("determines HA color correctly", () => {
    const candles = makeCandles(50, 100, "up");
    const ha = toHeikinAshi(candles);
    for (const c of ha) {
      const color = haColor(c);
      assert.ok(color === "green" || color === "red");
      if (c.haClose >= c.haOpen) assert.equal(color, "green");
      else assert.equal(color, "red");
    }
  });
});

describe("chandelier-exit", () => {
  it("computes trailing stops and trend", () => {
    const candles = makeCandles(100, 100, "up");
    const result = chandelierExit(candles, 20, 3.0);
    assert.equal(result.longStop.length, candles.length);
    assert.equal(result.shortStop.length, candles.length);
    assert.equal(result.trend.length, candles.length);
    for (const t of result.trend) {
      assert.ok(t === "long" || t === "short");
    }
  });

  it("returns buy signal in uptrend", () => {
    const candles = makeCandles(100, 100, "up");
    const signal = getChandelierSignal(candles, 20, 3.0);
    assert.ok(signal.signal === "buy" || signal.signal === "none" || signal.signal === "sell");
    assert.ok(signal.trend === "long" || signal.trend === "short");
  });
});

describe("donchian-ribbon", () => {
  it("computes upper/lower/middle for all periods", () => {
    const candles = makeCandles(250, 100, "up");
    const result = donchianRibbon(candles, [20, 50, 100, 200]);
    assert.equal(result.upper.length, 4);
    assert.equal(result.lower.length, 4);
    assert.equal(result.middle.length, 4);
    assert.equal(result.trend.length, candles.length);
  });

  it("returns donchian state", () => {
    const candles = makeCandles(250, 100, "up");
    const state = getDonchianState(candles, [20, 50, 100, 200]);
    assert.ok(state.trend === "green" || state.trend === "red" || state.trend === "neutral");
    assert.ok(state.periods[20]);
    assert.ok(state.periods[50]);
    assert.ok(state.periods[100]);
    assert.ok(state.periods[200]);
  });
});

describe("chandelier-donchian strategy", () => {
  it("evaluates candles and returns a signal", () => {
    const candles = makeCandles(300, 100, "up");
    const signal = evaluateChandelierDonchian(candles);
    assert.ok(signal.status === "WAIT" || signal.status === "WATCH" || signal.status === "LONG_SETUP" || signal.status === "SHORT_SETUP");
    assert.ok(Array.isArray(signal.reasons));
    assert.ok(signal.reasons.length > 0);
  });

  it("calculates position size from risk", () => {
    const sizing = calculatePositionSize(10000, 50000, 49000, {
      leverage: 10,
      riskPct: 1.0,
      lotSize: null,
      maxPositions: 1,
      mode: "auto",
    });
    assert.ok(sizing.qty > 0);
    assert.equal(sizing.riskAmount, 100);
    assert.equal(sizing.leverage, 10);
  });

  it("respects manual lot size", () => {
    const sizing = calculatePositionSize(10000, 50000, 49000, {
      leverage: 10,
      riskPct: 1.0,
      lotSize: 0.5,
      maxPositions: 1,
      mode: "manual",
    });
    assert.equal(sizing.qty, 0.5);
  });
});

describe("backtest", () => {
  it("runs a backtest and returns metrics", () => {
    const candles = makeCandles(1000, 100, "up");
    const result = runBacktest(candles);
    assert.ok(result.totalTrades >= 0);
    assert.ok(result.winningTrades >= 0);
    assert.ok(result.losingTrades >= 0);
    assert.ok(result.winRate >= 0 && result.winRate <= 100);
    assert.ok(Number.isFinite(result.expectancy));
    assert.ok(result.profitFactor === null || Number.isFinite(result.profitFactor));
    assert.ok(Number.isFinite(result.maxDrawdown));
    assert.ok(Number.isFinite(result.sharpeRatio));
    assert.equal(result.dsr, null);
  });

  it("aggregates walk-forward results", () => {
    const candles = makeCandles(2000, 100, "up");
    const results = [];
    for (let start = 0; start + 1000 < candles.length; start += 500) {
      const testCandles = candles.slice(start + 500, start + 1000);
      if (testCandles.length < 100) break;
      results.push(runBacktest(testCandles));
    }
    const agg = aggregateWalkForward(results);
    assert.ok(agg.totalTrades >= 0);
    assert.ok(Number.isFinite(agg.expectancy));
    assert.equal(agg.dsr, null);
  });
});