/**
 * Golden-value + structural tests for the quant port (cross-checked vs Python).
 * Run compiled: node --test output/quant-js/quant.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { atr, rsi, sma, maCross, closes } from "./indicators";
import { analyzeConfluence, gateSignal } from "./confluence";
import { buildFeatures, FEATURE_COLUMNS, toArray } from "./features";
import { findSwings, clusterZones, nearestZones, supportResZones } from "./zones";
import { regime, spearmanIC, neweyWestSE, bhFdr, tToP, purgedSplits } from "./diagnostics";
import type { Candle } from "@/lib/types";

/** Deterministic fixture — NO RNG so Python goldens replicate bit-exactly. */
export function fixture(n = 300): Candle[] {
  const out: Candle[] = [];
  let price = 100.0;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price + Math.sin(i / 15) * 0.8 + Math.sin(i / 3.7) * 0.25;
    const high = Math.max(open, close) + 0.2 + 0.1 * Math.sin(i / 2.1);
    const low = Math.min(open, close) - 0.2 - 0.1 * Math.cos(i / 2.3);
    const volume = 150 + 40 * Math.sin(i / 9) + 10 * Math.sin(i / 2.9);
    out.push({ time: 1700000000 + i * 900, open, high, low, close, volume });
    price = close;
  }
  return out;
}

/** Strict monotonic uptrend with rising volume. */
function uptrend(n = 160): Candle[] {
  const out: Candle[] = [];
  let price = 100.0;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price + 0.6;
    out.push({ time: 1700000000 + i * 900, open, high: close + 0.05, low: open - 0.05, close, volume: 100 + i });
    price = close;
  }
  return out;
}

describe("indicators", () => {
  it("ATR equals constant range exactly (no gaps)", () => {
    const cs: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      time: i, open: 100, high: 102, low: 98, close: 100, volume: 1,
    }));
    const a = atr(cs);
    assert.ok(a[14] !== null);
    assert.equal(a[14], 4); // TR = h-l = 4, Wilder seed = mean = 4
    assert.equal(a[29], 4);
  });
  it("RSI of strictly increasing closes is 100", () => {
    assert.equal(rsi(uptrend(40))[39], 100);
  });
  it("RSI of strictly decreasing closes is 0", () => {
    const cs = uptrend(40).map((c, i) => ({ ...c, close: 200 - i * 0.6 }));
    assert.equal(rsi(cs)[39], 0);
  });
  it("SMA closed form", () => {
    const s = sma([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 9);
    assert.equal(s[8], 5);
    assert.equal(s[9], 6);
    assert.equal(s[7], null);
  });
  it("causal prefix consistency: full-series value at k == prefix value at k", () => {
    const cs = fixture(200);
    for (const k of [30, 60, 100, 150, 199]) {
      const full = atr(cs)[k], pre = atr(cs.slice(0, k + 1))[k];
      assert.ok(Math.abs((full as number) - (pre as number)) < 1e-12, `ATR prefix k=${k}`);
      const rf = rsi(cs)[k], rp = rsi(cs.slice(0, k + 1))[k];
      assert.ok(Math.abs((rf as number) - (rp as number)) < 1e-12, `RSI prefix k=${k}`);
      const sf = sma(closes(cs), 21)[k], sp = sma(closes(cs.slice(0, k + 1)), 21)[k];
      assert.ok(Math.abs((sf as number) - (sp as number)) < 1e-12, `SMA prefix k=${k}`);
      assert.equal(maCross(cs)[k], maCross(cs.slice(0, k + 1))[k], `maCross prefix k=${k}`);
    }
  });
  it("maCross fires on a crafted cross", () => {
    const cs: Candle[] = [];
    for (let i = 0; i < 40; i++) {
      const close = i < 25 ? 100 - i * 0.2 : 95 + (i - 24) * 0.9;
      cs.push({ time: i, open: close, high: close + 0.1, low: close - 0.1, close, volume: 1 });
    }
    assert.equal(maCross(cs).filter((v) => v === 1).length, 1);
  });
});

describe("zones", () => {
  it("finds swings in the fixture (parity: Python reports 4 highs / 3 lows)", () => {
    const { highs, lows } = findSwings(fixture(300));
    assert.equal(highs.length, 4);
    assert.equal(lows.length, 3);
  });
  it("clusters nearby levels into (low, high) zones", () => {
    const z = clusterZones([100.0, 100.1, 100.2, 105.0]);
    assert.equal(z.length, 2);
    assert.equal(z[0].low, 100.0);
    assert.equal(z[0].high, 100.2);
    assert.equal(z[1].low, 105.0);
    assert.equal(z[1].high, 105.0);
  });
  it("nearest zones return the closest zone edge to price", () => {
    const cs = fixture(300);
    const close = cs[cs.length - 1].close;
    const { supZones, resZones } = supportResZones(cs, 5, 0.003);
    const { support, resistance } = nearestZones(cs);
    if (supZones.length) {
      const expected = supZones.reduce((best, z) =>
        Math.abs(close - z.high) < Math.abs(close - best.high) ? z : best).high;
      assert.equal(support, expected, "support = closest zone HIGH edge");
    }
    if (resZones.length) {
      const expected = resZones.reduce((best, z) =>
        Math.abs(close - z.low) < Math.abs(close - best.low) ? z : best).low;
      assert.equal(resistance, expected, "resistance = closest zone LOW edge");
    }
    assert.ok(support === null || support > 0);
    assert.ok(resistance === null || resistance > 0);
  });
});

describe("confluence", () => {
  it("returns NEUTRAL on insufficient data", () => {
    const r = analyzeConfluence(fixture(30), fixture(30));
    assert.equal(r.direction, "NEUTRAL");
    assert.equal(r.score, 50);
  });
  it("uptrend scores positive and gates LONG", () => {
    const up = uptrend(160);
    const r = analyzeConfluence(up, up);
    assert.ok(r.score > 50, `score ${r.score}`);
    assert.ok(r.components.trend > 0);
    assert.equal(gateSignal(r, "long").passed, true);
  });
  it("downtrend gates against a LONG signal", () => {
    const dn = uptrend(160).map((c, i) => ({
      ...c, close: 200 - i * 0.6, open: 200 - (i - 1) * 0.6,
      high: Math.max(200 - i * 0.6, 200 - (i - 1) * 0.6) + 0.05,
      low: Math.min(200 - i * 0.6, 200 - (i - 1) * 0.6) - 0.05,
    }));
    const r = analyzeConfluence(dn, dn);
    assert.ok(r.components.trend < 0);
    const g = gateSignal(r, "long");
    assert.equal(g.passed, false);
    assert.ok(g.reason.includes("CONFLUENCE_VETO") || g.reason.includes("LOW_CONFLUENCE"));
  });
  it("components stay within [-1, 1]", () => {
    const r = analyzeConfluence(fixture(300), fixture(300));
    for (const v of Object.values(r.components)) assert.ok(v >= -1 && v <= 1);
  });
});

describe("features", () => {
  it("returns 18 columns in order", () => {
    const f = buildFeatures(fixture(300));
    assert.ok(f !== null);
    assert.equal(FEATURE_COLUMNS.length, 18);
    assert.equal(toArray(f!).length, 18);
    assert.ok(Number.isFinite(f!.atr_norm));
    assert.ok(Number.isFinite(f!.rsi_14));
    assert.ok(Number.isFinite(f!.vol_ratio));
  });
  it("returns null under 60 candles", () => {
    assert.equal(buildFeatures(fixture(59)), null);
  });
});

describe("diagnostics", () => {
  it("spearman IC of x vs x is 1 (n>=30)", () => {
    const x = Array.from({ length: 60 }, (_, i) => i * 1.7);
    assert.ok(Math.abs(spearmanIC(x, x).ic - 1) < 1e-9);
  });
  it("spearman IC of x vs -x is -1", () => {
    const x = Array.from({ length: 60 }, (_, i) => i * 1.7);
    assert.ok(Math.abs(spearmanIC(x, x.map((v) => -v)).ic + 1) < 1e-9);
  });
  it("IC returns NaN under 30 pairs", () => {
    assert.ok(Number.isNaN(spearmanIC([1, 2, 3], [1, 2, 3]).ic));
  });
  it("rankAvg handles ties (tie-averaged ranks, n>=30 required)", () => {
    const x = Array.from({ length: 40 }, (_, i) => Math.floor(i / 4)); // heavy ties
    const r = spearmanIC(x, x);
    assert.equal(r.n, 40);
    assert.ok(Math.abs(r.ic - 1) < 1e-9, `ic ${r.ic}`);
  });
  it("Newey-West SE is positive and finite", () => {
    const s = Array.from({ length: 200 }, (_, i) => Math.sin(i / 5) + (i % 7) * 0.01);
    const se = neweyWestSE(s);
    assert.ok(Number.isFinite(se) && se > 0);
  });
  it("BH-FDR flags known case", () => {
    assert.deepEqual(bhFdr([0.01, 0.02, 0.5, 0.9], 0.1), [true, true, false, false]);
  });
  it("tToP maps t=1.96 to ~0.05", () => {
    assert.ok(Math.abs(tToP(1.96) - 0.05) < 0.001);
  });
  it("purgedSplits produces 3 folds of 100 test rows (n=400), purge holds", () => {
    const folds = purgedSplits(400, 4, 0.01);
    assert.equal(folds.length, 3);
    for (const f of folds) {
      assert.equal(f.test.length, 100);
      assert.ok(f.train.length >= 50);
      assert.ok(Math.max(...f.train) < Math.min(...f.test));
    }
  });
  it("regime returns trend|range", () => {
    const r = regime(fixture(300));
    assert.ok(r === "trend" || r === "range");
  });
});



/**
 * Parity against trader_bot_v2 on the identical deterministic fixture.
 * Golden values produced by output/py_parity.py against the Python engine
 * (trader_bot_v2 engine/ + ml4t/). Regenerate with:
 *   D:\Projects\trader_bot_v2\.venv\Scripts\python.exe output\py_parity.py
 */
describe("python parity", () => {
  const PY = {
    atr_last: 0.8070234678313705,
    rsi_last: 69.43762636502723,
    swings_high: 4,
    swings_low: 3,
    score: 56.4,
    direction: "NEUTRAL",
    trend: -0.4,
    zone: 0,
    momentum: 0.9831287909508168,
    volume: 0.142649758751898,
    features: {
      atr_norm: 0.007544632533761388,
      rsi_14: 69.43762636502723,
      rsi_dist50: 0.38875252730054455,
      ema_fast: -0.022671414683777424,
      ema_slow: -0.001163057459584671,
      ema_gap_atr: -2.850815745888918,
      ma_fast: -0.015682955634775286,
      ma_slow: -0.036494490828267834,
      ma_gap_atr: 2.758455776389813,
      ma_cross: 0, // genuine crossover semantics after the pandas-3 mask fix
      dist_support_atr: 8.548675730466014,
      dist_resist_atr: 22.480462018230746,
      wick_reject: 0.20551880482413423,
      trend_slope_atr: 0.15805595860023935,
      vol_ratio: 1.1257040232197315,
      ret_1: 0.004845497400506105,
      ret_4: 0.01656656831836978,
      range_atr: 0.9843985587627436,
    },
  };

  it("swing counts match Python", () => {
    const { highs, lows } = findSwings(fixture(300));
    assert.equal(highs.length, PY.swings_high, "swing highs");
    assert.equal(lows.length, PY.swings_low, "swing lows");
  });

  it("ATR and RSI match Python", () => {
    const cs = fixture(300);
    const a = atr(cs)[cs.length - 1] as number;
    const r = rsi(cs)[cs.length - 1] as number;
    assert.ok(Math.abs(a - PY.atr_last) < 1e-9, `atr ${a} vs ${PY.atr_last}`);
    assert.ok(Math.abs(r - PY.rsi_last) < 1e-7, `rsi ${r} vs ${PY.rsi_last}`);
  });

  it("all 18 features match Python", () => {
    const f = buildFeatures(fixture(300));
    assert.ok(f !== null);
    const v = toArray(f!);
    FEATURE_COLUMNS.forEach((k, i) => {
      const g = PY.features[k];
      assert.ok(Math.abs(v[i] - g) < 1e-6, `feature ${k}: ts ${v[i]} vs py ${g}`);
    });
  });

  it("confluence score, direction and components match Python", () => {
    const cs = fixture(300);
    const r = analyzeConfluence(cs, cs);
    assert.equal(r.score, PY.score, `score ${r.score}`);
    assert.equal(r.direction, PY.direction, `direction ${r.direction}`);
    assert.ok(Math.abs(r.components.trend - PY.trend) < 1e-9, `trend ${r.components.trend}`);
    assert.ok(Math.abs(r.components.zone - PY.zone) < 1e-9, `zone ${r.components.zone}`);
    assert.ok(Math.abs(r.components.momentum - PY.momentum) < 1e-6, `momentum ${r.components.momentum}`);
    assert.ok(Math.abs(r.components.volume - PY.volume) < 1e-6, `volume ${r.components.volume}`);
  });
});