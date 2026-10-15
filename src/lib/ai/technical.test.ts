import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyseTechnical,
  detectPatterns,
  ema,
  TECHNICAL_VERSION,
} from "./technical";
import { buildAiContext } from "./context";
import { recallMemory } from "./memory";
import { technicalConflicts } from "./rules";
import type { Candle } from "../types";
import type { AiContext, AiPrediction } from "./types";
const bar = (
  open: number,
  close: number,
  high = Math.max(open, close) + 0.1,
  low = Math.min(open, close) - 0.1,
): Candle => ({ time: 0, open, close, high, low, volume: 10 });
function assemble(tail: Candle[], up = false): Candle[] {
  const prior = Array.from({ length: 7 }, (_, i) =>
    bar(up ? 70 + i * 3 : 130 - i * 3, up ? 72 + i * 3 : 128 - i * 3),
  );
  return [...prior, ...tail].map((c, i) => ({ ...c, time: 172800 + i * 300 }));
}
const mirror = (c: Candle): Candle => ({
  ...c,
  open: 200 - c.open,
  close: 200 - c.close,
  high: 200 - c.low,
  low: 200 - c.high,
});
const pairs: [string, string, Candle[], boolean?][] = [
  ["Hammer", "Shooting Star", [bar(100, 101, 101.2, 96)]],
  ["Inverted Hammer", "Hanging Man", [bar(100, 101, 105, 99.8)]],
  ["Dragonfly Doji", "Gravestone Doji", [bar(100, 100.1, 100.15, 95)]],
  ["Bullish Engulfing", "Bearish Engulfing", [bar(105, 100), bar(99, 106)]],
  ["Bullish Harami", "Bearish Harami", [bar(110, 100), bar(102, 105)]],
  ["Piercing Line", "Dark Cloud Cover", [bar(110, 100), bar(99, 106)]],
  [
    "Tweezer Bottom",
    "Tweezer Top",
    [bar(105, 100, 105.1, 99), bar(100, 104, 104.1, 99)],
  ],
  [
    "Morning Star",
    "Evening Star",
    [bar(110, 100), bar(98, 98.5), bar(99, 107)],
  ],
  [
    "Three White Soldiers",
    "Three Black Crows",
    [bar(95, 100), bar(98, 104), bar(102, 108)],
  ],
  [
    "Three Inside Up",
    "Three Inside Down",
    [bar(110, 100), bar(102, 105), bar(104, 112)],
  ],
  [
    "Three Outside Up",
    "Three Outside Down",
    [bar(105, 100), bar(99, 106), bar(105, 110)],
  ],
  [
    "Three Star Bullish",
    "Three Star Bearish",
    [
      bar(100, 100.05, 102, 98),
      bar(96, 96.05, 98, 94),
      bar(100, 100.05, 102, 98),
    ],
  ],
  ["Bullish Marubozu", "Bearish Marubozu", [bar(100, 110)], true],
  [
    "Rising Three Methods",
    "Falling Three Methods",
    [
      bar(100, 110, 111, 99),
      bar(108, 106, 109, 105),
      bar(106, 104, 107, 103),
      bar(104, 102, 105, 101),
      bar(103, 113, 114, 102),
    ],
    true,
  ],
];
describe("versioned candle pattern geometry", () => {
  for (const [positive, negative, tail, up] of pairs) {
    it(`detects ${positive} with prior trend`, () => {
      assert.ok(
        detectPatterns(assemble(tail, up)).some((p) => p.name === positive),
      );
    });
    it(`detects ${negative} symmetrically`, () => {
      const input = assemble(tail, up).map(mirror);
      assert.ok(detectPatterns(input).some((p) => p.name === negative));
    });
  }
  it("detects doji and spinning top without directional claims", () => {
    assert.ok(
      detectPatterns(assemble([bar(100, 100, 102, 98)])).some(
        (p) => p.name === "Doji" && p.bias === "neutral",
      ),
    );
    assert.ok(
      detectPatterns(assemble([bar(100, 101, 104, 97)])).some(
        (p) => p.name === "Spinning Top",
      ),
    );
  });
  it("requires reversal context, rather than matching a screenshot shape alone", () => {
    assert.ok(
      !detectPatterns(assemble([bar(105, 100), bar(99, 106)], true)).some(
        (p) => p.name === "Bullish Engulfing",
      ),
    );
  });
  it("does not label zero-range candles as doji or directional marubozu", () => {
    assert.deepEqual(detectPatterns(assemble([bar(100, 100, 100, 100)])), []);
  });
  it("gap-specific patterns are not relaxed to fit continuous crypto bars", () => {
    assert.ok(
      !detectPatterns(assemble([bar(110, 100), bar(100, 106)])).some(
        (p) => p.name === "Piercing Line",
      ),
    );
  });
  it("is invariant to multiplicative price scale", () => {
    const c = assemble([bar(105, 100), bar(99, 106)]);
    assert.deepEqual(
      detectPatterns(c),
      detectPatterns(
        c.map((x) => ({
          ...x,
          open: x.open * 10,
          close: x.close * 10,
          high: x.high * 10,
          low: x.low * 10,
        })),
      ),
    );
  });
});
describe("indicators and causal strategy checklists", () => {
  it("SMA-seeds EMA and marks warmup honestly", () => {
    assert.deepEqual(ema([1, 2, 3, 4], 3), [null, null, 2, 3]);
  });
  it("uses population standard deviation for Bollinger Bands", () => {
    const c = Array.from({ length: 30 }, (_, i) => ({
      ...bar(100 + i, 100 + i),
      time: 172800 + i * 300,
    }));
    const t = analyseTechnical(c);
    assert.equal(t.indicators.bollinger!.middle, 119.5);
    assert.ok(
      Math.abs(t.indicators.bollinger!.upper - (119.5 + 2 * Math.sqrt(33.25))) <
        1e-9,
    );
    assert.equal(t.indicators.rsi14, 100);
    assert.equal(t.indicators.adx14, 100);
  });
  it("reports flat-market RSI as 50 and ADX as zero", () => {
    const c = Array.from({ length: 60 }, (_, i) => ({
      ...bar(100, 100, 100, 100),
      time: 172800 + i * 300,
    }));
    const t = analyseTechnical(c);
    assert.equal(t.indicators.rsi14, 50);
    assert.equal(t.indicators.adx14, 0);
    assert.equal(t.indicators.macd!.histogram, 0);
  });
  it("computes volume-weighted UTC session VWAP and resets daily", () => {
    const c = [
      { ...bar(10, 10, 10, 10), time: 172800, volume: 1 },
      { ...bar(20, 20, 20, 20), time: 173100, volume: 3 },
    ];
    assert.equal(analyseTechnical(c).indicators.vwap, 17.5);
    c.push({ ...bar(30, 30, 30, 30), time: 259200, volume: 2 });
    assert.equal(analyseTechnical(c).indicators.vwap, 30);
  });
  it("does not pretend a truncated session or zero volume is full VWAP", () => {
    const c = assemble([bar(100, 101)]);
    c.shift();
    assert.equal(analyseTechnical(c).indicators.vwap, null);
    assert.equal(
      analyseTechnical(
        assemble([bar(100, 101)]).map((x) => ({ ...x, volume: 0 })),
      ).indicators.vwap,
      null,
    );
  });
  it("warmup never passes an unavailable filter", () => {
    const t = analyseTechnical([{ ...bar(100, 101), time: 172800 }]);
    assert.equal(t.indicators.rsi14, null);
    assert.equal(t.indicators.adx14, null);
    assert.equal(t.indicators.macd, null);
    assert.ok(t.strategies.every((s) => s.direction === "NEUTRAL"));
    assert.ok(t.strategies[0].checks.some((c) => c.passed === null));
  });
  it("rejects malformed OHLC, nonfinite volume and duplicate time", () => {
    assert.throws(() => analyseTechnical([{ ...bar(100, 101), high: 90 }]));
    assert.throws(() => analyseTechnical([{ ...bar(100, 101), volume: NaN }]));
    assert.throws(() => analyseTechnical([bar(100, 101), bar(101, 102)]));
  });
  it("raw candle patterns are identical on regular and Heikin-Ashi contexts", () => {
    const candles = assemble([bar(105, 100), bar(99, 106)]);
    const a = buildAiContext({
      symbol: "BTCUSD",
      timeframe: "5m",
      chartType: "candles",
      candles,
    });
    const b = buildAiContext({
      symbol: "BTCUSD",
      timeframe: "5m",
      chartType: "heikin-ashi",
      candles,
    });
    assert.deepEqual(a.technical, b.technical);
  });
  it("prior cross is checked before the terminal breakout and not retroactively", () => {
    const candles = Array.from({ length: 70 }, (_, i) => ({
      ...bar(100, 100),
      time: 172800 + i * 300,
    }));
    const snapshot = JSON.stringify(analyseTechnical(candles));
    const later = [...candles, { ...bar(100, 150), time: 172800 + 70 * 300 }];
    assert.equal(
      JSON.stringify(analyseTechnical(later.slice(0, -1))),
      snapshot,
    );
    assert.ok(analyseTechnical(later).strategies[0].checks[0].passed === false); // cross is on latest bar, not confirmation
  });
});
function context(): AiContext {
  const c = buildAiContext({
    symbol: "BTCUSD",
    timeframe: "5m",
    chartType: "candles",
    candles: assemble([bar(105, 100), bar(99, 106)]),
  });
  c.dataSource = "live";
  c.lastBarTime = 10_000_000;
  return c;
}
function row(ctx: AiContext, id = "one", barTime = 1_000_000): AiPrediction {
  return {
    id,
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    chartType: ctx.chartType,
    provider: "rules",
    model: TECHNICAL_VERSION,
    direction: "LONG",
    confidence: 45,
    horizonBars: 6,
    rationale: "test",
    invalidation: 80,
    keyLevels: { support: 80, resistance: 120 },
    entryPrice: 100,
    createdAt: barTime,
    barTime,
    context: structuredClone(ctx),
    degraded: true,
    notice: "test",
    outcome: {
      resolution: "direction-correct",
      bars: 6,
      priceAtHorizon: 102,
      movePct: 2,
      invalidationHit: false,
    },
  };
}
describe("bounded comparable memory and safety veto", () => {
  it("retrieves matched settled calls and deduplicates overlapping examples", () => {
    const c = context();
    const recall = recallMemory(c, [
      row(c),
      row(c, "two"),
      row(c, "three", 1_300_000),
      row(c, "four", 4_000_000),
    ]);
    assert.equal(recall.matching, 2);
    assert.equal(recall.correct, 2);
    assert.match(recall.note, /Insufficient/);
  });
  it("excludes demo, other symbols, timeframes, chart type, old engine, unknown provenance and pending outcomes", () => {
    const c = context();
    const variants = Array.from({ length: 7 }, (_, i) => row(c, `${i}`));
    variants[0].context.dataSource = "demo";
    variants[1].symbol = "ETHUSD";
    variants[2].timeframe = "15m";
    variants[3].chartType = "heikin-ashi";
    variants[4].context.technical!.version = "old";
    delete variants[5].context.dataSource;
    variants[6].outcome = null;
    assert.equal(recallMemory(c, variants).matching, 0);
  });
  it("never retrieves a result whose horizon was still in the future at the current decision bar", () => {
    const c = context();
    assert.equal(recallMemory(c, [row(c, "future", 9_000_000)]).matching, 0);
  });
  it("does not count neutral abstentions as successful pattern examples", () => {
    const c = context(),
      p = row(c);
    p.direction = "NEUTRAL";
    assert.equal(recallMemory(c, [p]).matching, 0);
  });
  it("abstains when a contextual pattern opposes the proposed direction", () => {
    const c = context();
    assert.equal(technicalConflicts(c, "NEUTRAL").length, 0);
    assert.ok(technicalConflicts(c, "SHORT").length > 0);
  });
});
