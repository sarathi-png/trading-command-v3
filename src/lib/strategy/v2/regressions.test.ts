import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { donchianRibbon } from "./donchian";
import { chandelierExit } from "./chandelier";
import { calculatePositionSize, evaluateChandelierDonchian } from "./chandelier-donchian";
import { DEFAULT_CHANDELIER_DONCHIAN_CONFIG as defaults, validateStrategyConfig } from "./types";
import { runBacktest, runWalkForward } from "./backtest";
import { breakoutStrategy, buildAnalysis } from "../engine";
import { evaluateOrderRisk, normalizeRiskLimits } from "../../risk";
import type { Candle } from "../../types";

const bar = (i: number, price: number): Candle => ({ time: 1700000000 + i * 300, open: price, high: price + 1, low: price - 1, close: price + 0.5, volume: 100 });
const candles = Array.from({ length: 320 }, (_, i) => bar(i, 100 + i));
const config = { ...defaults, donchian: { periods: [5, 10] } };

describe("strategy correctness regressions", () => {
  it("Donchian uses prior highs/lows and can actually turn red", () => {
    const rows = [bar(0, 100), bar(1, 100), bar(2, 103), bar(3, 90)];
    const r = donchianRibbon(rows, [2]);
    assert.equal(r.trend[0], "neutral");
    assert.equal(r.upper[0][2], 101);
    assert.equal(r.trend[2], "green");
    assert.equal(r.trend[3], "red");
  });
  it("Chandelier handles empty data and waits for ATR warmup", () => {
    assert.deepEqual(chandelierExit([]).trend, []);
    assert.ok(Number.isNaN(chandelierExit(candles.slice(0, 10)).longStop[9]));
  });
  it("indicator prefixes are invariant to future candles", () => {
    const prefix = candles.slice(0, 100);
    const a = chandelierExit(prefix);
    const b = chandelierExit(candles);
    assert.deepEqual(a.longStop, b.longStop.slice(0, 100));
    assert.deepEqual(donchianRibbon(prefix, [5]).trend, donchianRibbon(candles, [5]).trend.slice(0, 100));
  });
  it("HA signal entry and price are real closes, not synthetic closes", () => {
    const s = evaluateChandelierDonchian(candles, config);
    assert.equal(s.status, "LONG_SETUP");
    assert.equal(s.entry, candles.at(-1)!.close);
    assert.equal(s.price, candles.at(-1)!.close);
  });
  it("zero stop distance and invalid sizing inputs produce no order", () => {
    for (const [equity, entry, stop] of [[10000, 100, 100], [NaN, 100, 90], [-1, 100, 90]]) {
      const r = calculatePositionSize(equity, entry, stop, defaults.risk);
      assert.equal(r.qty, 0);
      assert.equal(r.riskAmount, 0);
    }
  });
  it("sizing reports actual risk after margin caps and manual overrides", () => {
    const r = calculatePositionSize(100, 100, 50, { ...defaults.risk, riskPct: 100, leverage: 1 });
    assert.equal(r.qty, 1);
    assert.equal(r.riskAmount, 50);
    assert.equal(r.riskPct, 50);
    assert.equal(calculatePositionSize(10000, 50000, 49000, { ...defaults.risk, mode: "manual", lotSize: 0.5 }).riskAmount, 500);
  });
  it("fills at next raw open and holds exactly the configured number of bars", () => {
    const r = runBacktest(candles, { ...config, timeStop: { enabled: true, bars: 3 } });
    assert.ok(r.totalTrades > 0);
    for (const t of r.trades) {
      const index = candles.findIndex(c => c.time === t.entryTime);
      assert.equal(t.entryPrice, candles[index].open);
      assert.ok(index >= 60);
      if (t.exitReason === "time_stop") assert.equal(t.barsHeld, 3);
    }
    assert.equal(r.dsr, null);
  });
  it("walk-forward accepts exact final window and rejects overlap/zero steps", () => {
    assert.equal(runWalkForward(candles.slice(0, 100), config, 70, 30).length, 1);
    assert.throws(() => runWalkForward(candles, config, 70, 30, 0));
    assert.throws(() => runWalkForward(candles, config, 70, 30, 15));
  });
  it("rejects unbounded and invalid strategy configuration", () => {
    assert.throws(() => validateStrategyConfig({ ...config, donchian: { periods: [] } }));
    assert.throws(() => validateStrategyConfig({ ...config, chandelier: { atrLength: 0, multiplier: 3 } }));
  });
  it("breakouts cross historical resistance rather than reclassified current levels", () => {
    const rows = [100, 101, 105, 101, 100, 101, 105, 101, 100, 101, 107, 108].map((v, i) => bar(i, v));
    const a = buildAnalysis("BTCUSD", "5m", rows, { sensitivity: 0.002, minTouches: 2, lookback: 100 }, { breakout: true }, [breakoutStrategy]);
    assert.equal(a.signals[0].status, "LONG_SETUP");
    assert.equal(a.signals[0].entry, rows.at(-2)!.close);
  });
});

describe("risk regressions", () => {
  const ctx = { limits: normalizeRiskLimits({}), openSymbols: [], currentNotional: 0, equity: 10000, dailyRealizedPnl: 0 };
  it("fails closed on invalid equity and exposure", () => {
    for (const bad of [{ equity: 0 }, { equity: NaN }, { currentNotional: Infinity }]) {
      assert.equal(evaluateOrderRisk({ symbol: "BTCUSD", price: 100, qty: 1, reduceOnly: false }, { ...ctx, ...bad }).allowed, false);
    }
  });
  it("cannot normalize a fractional position count to unlimited zero", () => {
    assert.equal(normalizeRiskLimits({ maxOpenPositions: 0.1 }).maxOpenPositions, 1);
  });
});
