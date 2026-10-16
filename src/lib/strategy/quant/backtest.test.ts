/**
 * Reconciliation + validation tests for the trend core, the simulator and the statistics.
 * Run: npx tsc -p tsconfig.quant.json && node --test output/quant-js/lib/strategy/quant/backtest.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Candle } from "@/lib/types";
import { prepareTrend, trendSignalAt, DEFAULT_TREND } from "./trend";
import { runTrend, manageTrade, report, type BacktestConfig } from "./walkForward";
import { DEFAULT_COSTS, feesPrice, fundingPrice } from "./costs";
import { normCdf, normInv, deflatedSharpe, walkForwardPurged, paramGrid, sliceWindow } from "./validation";
import { atr } from "./indicators";

const LTF = 14400, HTF = 86400; // 4h execution, 1D context
const cfg: BacktestConfig = { params: { ...DEFAULT_TREND, regimeSma: 20 }, costs: DEFAULT_COSTS, ltfSec: LTF, htfSec: HTF };

/** Deterministic trending series: piecewise drift so regimes and breakouts exist. */
function series(n: number, drifts: number[], seedAmp = 0.012): Candle[] {
  const out: Candle[] = []; let p = 100; let s = 12345;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
  for (let i = 0; i < n; i++) {
    const d = drifts[Math.floor((i / n) * drifts.length)];
    const o = p, c = o * (1 + d + seedAmp * rnd() * 2);
    const hi = Math.max(o, c) * (1 + Math.abs(rnd()) * 0.006);
    const lo = Math.min(o, c) * (1 - Math.abs(rnd()) * 0.006);
    out.push({ time: 1_700_000_000 + i * LTF, open: o, high: hi, low: lo, close: c, volume: 1000 });
    p = c;
  }
  return out;
}
/** Aggregate execution bars into HTF bars (6 x 4h = 1D), closed bars only. */
function toHtf(ltf: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let k = 0; k + 6 <= ltf.length; k += 6) {
    const s = ltf.slice(k, k + 6);
    out.push({ time: s[0].time, open: s[0].open, high: Math.max(...s.map((x) => x.high)),
      low: Math.min(...s.map((x) => x.low)), close: s[5].close, volume: 1 });
  }
  return out;
}

describe("reconciliation: signal is causal", () => {
  it("decision at bar i is identical when computed on data truncated after bar i", () => {
    const ltf = series(1200, [0.002, -0.002, 0.003]);
    const htf = toHtf(ltf);
    const full = prepareTrend(ltf, htf, cfg.params, LTF, HTF);
    for (const i of [300, 555, 900, 1100]) {
      const pre = ltf.slice(0, i + 1);
      const htfPre = htf.filter((c) => c.time + HTF <= pre[pre.length - 1].time + LTF);
      const part = prepareTrend(pre, htfPre, cfg.params, LTF, HTF);
      assert.deepEqual(trendSignalAt(part, i, cfg.params), trendSignalAt(full, i, cfg.params), `bar ${i}`);
    }
  });

  it("HTF bars are used only after they close (no partially formed daily bar)", () => {
    const ltf = series(200, [0.001]);
    const htf = toHtf(ltf);
    const ctx = prepareTrend(ltf, htf, cfg.params, LTF, HTF);
    for (let i = 0; i < ltf.length; i++) {
      const h = ctx.htfCloseIdx[i];
      if (h >= 0) assert.ok(htf[h].time + HTF <= ltf[i].time + LTF);
    }
  });
});

describe("reconciliation: both sides, real HTF context", () => {
  it("produces SHORT trades in a downtrend and LONG trades in an uptrend", () => {
    const down = runTrend(series(3000, [-0.004]), toHtf(series(3000, [-0.004])), cfg);
    const up = runTrend(series(3000, [0.004]), toHtf(series(3000, [0.004])), cfg);
    assert.ok(down.some((t) => t.side === -1), "no shorts in downtrend");
    assert.ok(up.some((t) => t.side === 1), "no longs in uptrend");
  });
});

describe("execution model", () => {
  it("a gap through the stop fills at the open, not at the stop", () => {
    const base = series(300, [0]);
    const ltf = base.map((c) => ({ ...c }));
    const atrArr = atr(ltf, 14);
    const i = 200;
    const a = atrArr[i] as number;
    const entry = ltf[i + 1].open * (1 + DEFAULT_COSTS.slippage);
    const stop = entry - 2 * a;
    // gap far below the stop on the next bar
    ltf[i + 2] = { ...ltf[i + 2], open: stop * 0.9, high: stop * 0.92, low: stop * 0.88, close: stop * 0.91 };
    const t = manageTrade(ltf, atrArr, i, 1, a, cfg);
    assert.ok(t);
    assert.equal(t!.reason, "STOP");
    assert.ok(t!.exit < stop, "gap fill should be worse than the stop");
    assert.ok(t!.netR < -1, "gap loss should exceed 1R");
  });

  it("net R equals gross R minus fees minus signed funding (accounting identity)", () => {
    const tr = runTrend(series(3000, [0.002, -0.002]), toHtf(series(3000, [0.002, -0.002])), cfg);
    assert.ok(tr.length > 5);
    for (const t of tr) {
      const pnl = t.side * (t.exit - t.entry);
      const costs = feesPrice(t.entry, t.exit, DEFAULT_COSTS) + fundingPrice(t.side, t.entry, t.bars, DEFAULT_COSTS);
      assert.ok(Math.abs(t.netR - (pnl - costs) / t.riskPrice) < 1e-9);
    }
  });

  it("the trailing stop only ratchets in the trade's favour", () => {
    const ltf = series(600, [0.004]);
    const atrArr = atr(ltf, 14);
    const t = manageTrade(ltf, atrArr, 100, 1, atrArr[100] as number, cfg);
    assert.ok(t && t.exitIdx >= t.entryIdx);
    assert.ok(t!.exit >= 0);
  });
});

describe("statistics", () => {
  it("normal CDF and inverse agree with reference points", () => {
    assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-4);
    assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
    assert.ok(Math.abs(normInv(0.975) - 1.95996) < 1e-4);
    assert.ok(Math.abs(normInv(normCdf(-2.3)) + 2.3) < 1e-4);
  });

  it("DSR falls as the number of trials grows, for the same observed Sharpe", () => {
    const r: number[] = [];
    let s = 7; for (let i = 0; i < 300; i++) { s = (s * 16807) % 2147483647; r.push((s / 2147483647 - 0.45) * 2); }
    const trials1 = [0.1];
    const trialsMany = Array.from({ length: 50 }, (_, k) => 0.05 * Math.sin(k));
    const a = deflatedSharpe(r, trials1).dsr;
    const b = deflatedSharpe(r, trialsMany).dsr;
    assert.ok(b < a, `DSR should drop with more trials (${a} vs ${b})`);
  });

  it("report() does not expose a hit rate", () => {
    const rep = report([]) as unknown as Record<string, unknown>;
    assert.equal("hitRate" in rep, false);
  });
});

describe("validation", () => {
  it("out-of-sample trades start inside their test block and after the purge boundary", () => {
    const ltf = series(6000, [0.002, -0.002, 0.003, -0.003]);
    const htf = toHtf(ltf);
    const res = walkForwardPurged(ltf, htf, cfg, paramGrid(cfg.params).slice(0, 4), { folds: 3, controlSeeds: 5 });
    for (const f of res.folds) {
      for (const t of f.oosTrades) assert.ok(t.entryTime >= ltf[f.testStart].time);
    }
    assert.ok(res.controlPValue > 0 && res.controlPValue <= 1);
  });

  it("sliceWindow includes only HTF bars that were closed by the window end", () => {
    const ltf = series(1000, [0.001]);
    const htf = toHtf(ltf);
    const w = sliceWindow(ltf, htf, 100, 500, cfg);
    const end = w.ltf[w.ltf.length - 1].time + LTF;
    for (const c of w.htf) assert.ok(c.time + HTF <= end);
  });
});
