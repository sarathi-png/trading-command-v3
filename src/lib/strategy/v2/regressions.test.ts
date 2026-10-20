import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { donchianRibbon } from "./donchian";
import { chandelierExit, wilderAtr } from "./chandelier";
import { atr as sharedAtr } from "../../indicators";
import { calculatePositionSize, decideSignal, evaluateChandelierDonchian } from "./chandelier-donchian";
import { toHeikinAshi, haColor } from "./heikin-ashi";
import { DEFAULT_CHANDELIER_DONCHIAN_CONFIG as defaults, validateStrategyConfig } from "./types";
import type { HeikinAshiCandle } from "./types";
import { runBacktest, runWalkForward } from "./backtest";
import { evaluateSetupOutcome, summariseOutcomes, sideOf } from "./outcomes";
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
    assert.ok(Number.isNaN(chandelierExit(candles.slice(0, 10), 20, 3).longStop[9]));
  });
  it("chandelier ATR is the shared Wilder ATR series", () => {
    const canonical = sharedAtr(candles, 14);
    const adapted = wilderAtr(candles, 14);
    assert.equal(adapted.length, canonical.length);
    for (let i = 0; i < canonical.length; i++) {
      const a = canonical[i];
      if (a === null) assert.ok(Number.isNaN(adapted[i]), `bar ${i} should be unavailable`);
      else assert.ok(Math.abs(a - adapted[i]) < 1e-12, `bar ${i} differs`);
    }
  });
  it("defaults to ATR length 1 and multiplier 2 while respecting explicit overrides", () => {
    assert.deepEqual(chandelierExit(candles), chandelierExit(candles, 1, 2));
    assert.notDeepEqual(chandelierExit(candles), chandelierExit(candles, 20, 3));
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
      const slipped = t.side === "long"
        ? candles[index].open * (1 + 0.0001)
        : candles[index].open * (1 - 0.0001);
      assert.ok(Math.abs(t.entryPrice - slipped) < 1e-9, "entry includes adverse slippage");
      assert.ok(index >= 60);
      if (t.exitReason === "time_stop") assert.equal(t.barsHeld, 3);
    }
    assert.equal(r.dsr, null);
  });
  it("precomputed backtest decisions match the prefix evaluator bar for bar", () => {
    const series = config.heikinAshi ? toHeikinAshi(candles) : candles;
    const indicators = chandelierExit(series, config.chandelier.atrLength, config.chandelier.multiplier);
    const donchian = donchianRibbon(series, config.donchian.periods);
    for (const i of [120, 180, 250, 319]) {
      const j = i - 1;
      const trend = indicators.trend[j];
      const fast = decideSignal({
        marketClose: candles[j].close,
        timestamp: series[j].time,
        chandelierSignal: trend === "long" && Number.isFinite(indicators.longStop[j])
          ? "buy" : trend === "short" && Number.isFinite(indicators.shortStop[j]) ? "sell" : "none",
        longStop: indicators.longStop[j],
        shortStop: indicators.shortStop[j],
        donchianTrend: donchian.trend[j] ?? "neutral",
        haColor: config.heikinAshi ? haColor(series[j] as HeikinAshiCandle) : series[j].close >= series[j].open ? "green" : "red",
        periods: config.donchian.periods,
      });
      const prefix = evaluateChandelierDonchian(candles.slice(0, i), config);
      assert.equal(fast.status, prefix.status, `status at ${i}`);
      assert.equal(fast.entry, prefix.entry, `entry at ${i}`);
      assert.equal(fast.stop, prefix.stop, `stop at ${i}`);
      assert.equal(fast.target, prefix.target, `target at ${i}`);
      assert.equal(fast.ts, prefix.ts);
    }
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

describe("signal accountability", () => {
  const signalTs = (i: number) => (1700000000 + i * 300) * 1000;
  const barAt = (i: number, low: number, high: number, close = (low + high) / 2): Candle =>
    ({ time: 1700000000 + i * 300, open: close, high, low, close, volume: 1 });

  it("maps only directional setups", () => {
    assert.equal(sideOf("LONG_SETUP"), "long");
    assert.equal(sideOf("SHORT_SETUP"), "short");
    assert.equal(sideOf("WATCH"), null);
    assert.equal(evaluateSetupOutcome({ status: "WATCH", entry: 100, stop: 99, target: 102, ts: signalTs(0) }, [barAt(1, 99, 103)]).resolution, "unknown");
  });

  it("scores a target hit at the planned R", () => {
    const o = evaluateSetupOutcome({ status: "LONG_SETUP", entry: 100, stop: 98, target: 104, ts: signalTs(0) },
      [barAt(1, 99.5, 101.5), barAt(2, 99.5, 104.5, 104)]);
    assert.equal(o.resolution, "target");
    assert.equal(o.barsToResolution, 2);
    assert.equal(o.currentR, 2);
    assert.equal(o.maeR, 0.25);
    assert.equal(o.mfeR, 2.25);
  });

  it("assumes the stop filled first when one candle touches both levels", () => {
    const o = evaluateSetupOutcome({ status: "LONG_SETUP", entry: 100, stop: 98, target: 104, ts: signalTs(0) },
      [barAt(1, 97, 105)]);
    assert.equal(o.resolution, "stop");
    assert.equal(o.currentR, -1);
  });

  it("reports an in-progress setup without inventing a result", () => {
    const o = evaluateSetupOutcome({ status: "SHORT_SETUP", entry: 100, stop: 102, target: 96, ts: signalTs(0) },
      [barAt(1, 98, 101, 99), barAt(2, 97.5, 100.5, 98)]);
    assert.equal(o.resolution, "open");
    assert.equal(o.currentR, 1);
    assert.equal(o.barsToResolution, null);
  });

  it("refuses to score setups with no forward candles or an inverted stop", () => {
    assert.equal(evaluateSetupOutcome({ status: "LONG_SETUP", entry: 100, stop: 98, target: 104, ts: signalTs(9) },
      [barAt(1, 99, 101)]).resolution, "unknown");
    assert.match(evaluateSetupOutcome({ status: "LONG_SETUP", entry: 100, stop: 102, target: 104, ts: signalTs(0) },
      [barAt(1, 99, 101)]).reason ?? "", /wrong side/);
  });

  it("rejects a target on the wrong side instead of scoring it as hit", () => {
    const o = evaluateSetupOutcome({ status: "SHORT_SETUP", entry: 100, stop: 102, target: 104, ts: signalTs(0) }, [barAt(1, 99, 101)]);
    assert.equal(o.resolution, "unknown");
    assert.match(o.reason ?? "", /wrong side/);
  });

  it("aggregates hit rate, average R and excursions", () => {
    const target = evaluateSetupOutcome({ status: "LONG_SETUP", entry: 100, stop: 98, target: 104, ts: signalTs(0) }, [barAt(1, 99, 104.5)]);
    const stopped = evaluateSetupOutcome({ status: "SHORT_SETUP", entry: 100, stop: 102, target: 96, ts: signalTs(0) }, [barAt(1, 99, 102.5)]);
    const agg = summariseOutcomes([target, stopped, { side: null, bars: 0, resolution: "unknown", barsToResolution: null, mfeR: null, maeR: null, currentR: null, lastPrice: null }]);
    assert.equal(agg.recorded, 3);
    assert.equal(agg.evaluated, 2);
    assert.equal(agg.unresolved, 1);
    assert.equal(agg.hitRate, 50);
    assert.equal(agg.avgResolvedR, 0.5);
    assert.equal(summariseOutcomes([]).hitRate, null);
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
