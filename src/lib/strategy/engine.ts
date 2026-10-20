/**
 * Modular strategy engine.
 *
 * Strategies are plain functions implementing a shared interface — they
 * receive market context and return a neutral signal (WAIT / WATCH /
 * LONG_SETUP / SHORT_SETUP / INVALIDATED) with explicit reasoning.
 * Nothing here claims certainty: outputs are "setups", not predictions.
 */
import type {
  Analysis, Candle, SRLevel, StrategySignal, StructurePoint,
  Timeframe, TrendState,
} from "../types";
import { ema } from "../indicators";

export interface StrategyContext {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[]; // closed candles, oldest → newest
  trend: TrendState;
  structure: StructurePoint[];
  levels: SRLevel[];
  breakoutLevels?: SRLevel[];
  emaFast: number;
  emaSlow: number;
  lastClose: number;
  lastTime: number;
}

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  evaluate: (ctx: StrategyContext) => StrategySignal;
}

function sig(
  ctx: StrategyContext,
  strategy: string,
  status: StrategySignal["status"],
  reasons: string[],
  levels?: { entry: number; stop: number; target: number }
): StrategySignal {
  let rr: number | null = null;
  if (levels) {
    const risk = Math.abs(levels.entry - levels.stop);
    rr = risk > 0 ? Math.abs(levels.target - levels.entry) / risk : null;
  }
  return {
    symbol: ctx.symbol,
    timeframe: ctx.timeframe,
    strategy,
    status,
    price: ctx.lastClose,
    entry: levels?.entry ?? null,
    stop: levels?.stop ?? null,
    target: levels?.target ?? null,
    rr: rr !== null ? Number(rr.toFixed(2)) : null,
    reasons,
    ts: ctx.lastTime * 1000,
  };
}

/* ---------------- indicators ---------------- */

interface Swing { index: number; time: number; price: number; side: "high" | "low" }

export function detectSwings(candles: Candle[], fractal = 2): Swing[] {
  const swings: Swing[] = [];
  for (let i = fractal; i < candles.length - fractal; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= fractal; j++) {
      if (candles[i - j].high >= c.high || candles[i + j].high >= c.high) isHigh = false;
      if (candles[i - j].low <= c.low || candles[i + j].low <= c.low) isLow = false;
    }
    if (isHigh) swings.push({ index: i, time: c.time, price: c.high, side: "high" });
    if (isLow) swings.push({ index: i, time: c.time, price: c.low, side: "low" });
  }
  return swings.sort((a, b) => a.index - b.index);
}

function classifySwings(swings: Swing[]): StructurePoint[] {
  const out: StructurePoint[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  for (const s of swings) {
    if (s.side === "high") {
      if (lastHigh !== null) {
        out.push({ time: s.time, price: s.price, kind: s.price > lastHigh ? "HH" : "LH" });
      }
      lastHigh = s.price;
    } else {
      if (lastLow !== null) {
        out.push({ time: s.time, price: s.price, kind: s.price > lastLow ? "HL" : "LL" });
      }
      lastLow = s.price;
    }
  }
  return out;
}

/* ---------------- structure, trend, levels ---------------- */

export interface StructureOptions {
  sensitivity: number;
  minTouches: number;
  lookback: number;
}

export function buildAnalysis(
  symbol: string,
  timeframe: Timeframe,
  rawCandles: Candle[],
  opts: StructureOptions,
  enabledStrategies: Record<string, boolean>,
  strategies: StrategyDef[]
): Analysis {
  // Analyse closed candles only — the forming candle is not evidence.
  const candles = rawCandles.slice(0, Math.max(rawCandles.length - 1, 0));
  const closes = candles.map((c) => c.close);
  const lookback = Math.min(opts.lookback, candles.length);
  const window = candles.slice(-lookback);
  const swingsRaw = detectSwings(window, 2);
  const structure = classifySwings(swingsRaw);
  const seq = structure.slice(-6).map((p) => p.kind);

  const emaFastArr = ema(closes, 20);
  const emaSlowArr = ema(closes, 50);
  const emaFast = emaFastArr[emaFastArr.length - 1] ?? closes[closes.length - 1] ?? 0;
  const emaSlow = emaSlowArr[emaSlowArr.length - 1] ?? emaFast;
  const last = candles[candles.length - 1];
  const lastClose = last?.close ?? 0;

  let bull = 0;
  let bear = 0;
  for (const k of seq) {
    if (k === "HH" || k === "HL") bull++;
    if (k === "LH" || k === "LL") bear++;
  }
  let trend: TrendState = "UNCLEAR";
  if (bull >= 2 && bear === 0 && emaFast > emaSlow) trend = "BULLISH";
  else if (bear >= 2 && bull === 0 && emaFast < emaSlow) trend = "BEARISH";
  else if (bull >= 1 && bear >= 1) trend = "RANGE";

  const levels = findLevels(window, swingsRaw, lastClose, opts);

  const ctx: StrategyContext = {
    symbol, timeframe, candles, trend, structure, levels,
    breakoutLevels: findLevels(window.slice(0, -1), detectSwings(window.slice(0, -1), 2), candles.at(-2)?.close ?? 0, opts),
    emaFast, emaSlow, lastClose, lastTime: last?.time ?? Math.floor(Date.now() / 1000),
  };

  const signals = strategies
    .filter((s) => enabledStrategies[s.id] !== false)
    .map((s) => s.evaluate(ctx));

  return {
    symbol, timeframe, trend,
    structureSeq: seq,
    swings: structure.slice(-8),
    levels,
    emaFast, emaSlow,
    lastClose,
    signals,
    evaluatedAt: Date.now(),
  };
}

export function findLevels(
  window: Candle[],
  swings: Swing[],
  price: number,
  opts: StructureOptions
): SRLevel[] {
  const tol = price * opts.sensitivity;
  const clusters: { sum: number; n: number; last: number }[] = [];
  for (const s of swings) {
    let hit = false;
    for (const c of clusters) {
      if (Math.abs(c.sum / c.n - s.price) <= tol) {
        c.sum += s.price;
        c.n += 1;
        c.last = Math.max(c.last, s.time);
        hit = true;
        break;
      }
    }
    if (!hit) clusters.push({ sum: s.price, n: 1, last: s.time });
  }
  const lastTime = window[window.length - 1]?.time ?? 0;
  const levels: SRLevel[] = clusters
    .filter((c) => c.n >= opts.minTouches)
    .map((c) => {
      const lvl = c.sum / c.n;
      const recency = Math.max(0.35, 1 - (lastTime - c.last) / (40 * 3600));
      return {
        price: lvl,
        kind: lvl < price ? ("support" as const) : ("resistance" as const),
        touches: c.n,
        strength: Math.min(1, (c.n / 4) * 0.6 + recency * 0.4),
        lastTouch: c.last,
      };
    });
  const support = levels
    .filter((l) => l.kind === "support")
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);
  const resistance = levels
    .filter((l) => l.kind === "resistance")
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);
  return [...support, ...resistance].sort((a, b) => b.price - a.price);
}

/* ---------------- strategies ---------------- */

const near = (a: number, b: number, frac: number) => Math.abs(a - b) <= b * frac;

export const trendStrategy: StrategyDef = {
  id: "trend",
  name: "Trend Pullback",
  description: "EMA-aligned trend continuation: waits for price to return to the fast EMA inside an established trend.",
  evaluate(ctx) {
    const { lastClose: c, emaFast: f, emaSlow: s, trend } = ctx;
    const lastSwingLow = [...ctx.structure].reverse().find((p) => p.kind === "HL" || p.kind === "LL");
    const lastSwingHigh = [...ctx.structure].reverse().find((p) => p.kind === "HH" || p.kind === "LH");
    if (trend === "BULLISH") {
      if (c > f * 1.012) {
        return sig(ctx, "trend", "WATCH", [
          "Trend is bullish (EMA20 > EMA50, rising swings)",
          `Price is extended ${( ((c / f - 1) * 100).toFixed(2) )}% above EMA20 — wait for pullback`,
        ]);
      }
      if (c >= f * 0.997 && c <= f * 1.006) {
        const stop = Math.min(lastSwingLow?.price ?? s, s) * 0.998;
        const entry = c;
        const target = entry + 2 * (entry - stop);
        return sig(ctx, "trend", "LONG_SETUP", [
          "Trend is bullish (EMA20 > EMA50, rising swings)",
          "Price pulled back into the EMA20 zone",
          `Stop reference: last swing low ${stop.toFixed(2)}`,
        ], { entry, stop, target });
      }
      return sig(ctx, "trend", "WAIT", [
        "Trend is bullish but price is not in the pullback zone",
      ]);
    }
    if (trend === "BEARISH") {
      if (c < f * 0.988) {
        return sig(ctx, "trend", "WATCH", [
          "Trend is bearish",
          "Price is extended below EMA20 — wait for retrace",
        ]);
      }
      if (c <= f * 1.003 && c >= f * 0.994) {
        const stop = Math.max(lastSwingHigh?.price ?? s, s) * 1.002;
        const entry = c;
        const target = entry - 2 * (stop - entry);
        return sig(ctx, "trend", "SHORT_SETUP", [
          "Trend is bearish (EMA20 < EMA50, falling swings)",
          "Price retraced into the EMA20 zone",
        ], { entry, stop, target });
      }
      return sig(ctx, "trend", "WAIT", ["Trend is bearish but price is not in the retrace zone"]);
    }
    return sig(ctx, "trend", "WAIT", [
      `No established trend (state: ${trend}). Trend strategy stands aside.`,
    ]);
  },
};

export const breakoutStrategy: StrategyDef = {
  id: "breakout",
  name: "Level Breakout",
  description: "Detects closes beyond the strongest detected support/resistance clusters.",
  evaluate(ctx) {
    const c = ctx.lastClose;
    const priorClose = ctx.candles.at(-2)?.close ?? c;
    const levels = ctx.breakoutLevels ?? ctx.levels;
    const res = levels.filter((l) => l.kind === "resistance").sort((a, b) => a.price - b.price)[0];
    const sup = levels.filter((l) => l.kind === "support").sort((a, b) => b.price - a.price)[0];
    if (res && priorClose <= res.price && c > res.price) {
      const stop = res.price * 0.998;
      const entry = c;
      const target = entry + 1.5 * (entry - stop);
      return sig(ctx, "breakout", "LONG_SETUP", [
        `Close above resistance ${res.price.toFixed(2)} (${res.touches} touches)`,
        "Breakout condition met on a closed candle",
      ], { entry, stop, target });
    }
    if (res && near(c, res.price, 0.0035) && c <= res.price) {
      return sig(ctx, "breakout", "WATCH", [
        `Price is pressing resistance ${res.price.toFixed(2)} (${res.touches} touches)`,
        "Breakout not confirmed — no close above the level yet",
      ]);
    }
    if (sup && priorClose >= sup.price && c < sup.price) {
      const stop = sup.price * 1.002;
      const entry = c;
      const target = entry - 1.5 * (stop - entry);
      return sig(ctx, "breakout", "SHORT_SETUP", [
        `Close below support ${sup.price.toFixed(2)} (${sup.touches} touches)`,
        "Breakdown condition met on a closed candle",
      ], { entry, stop, target });
    }
    if (sup && near(c, sup.price, 0.0035) && c >= sup.price) {
      return sig(ctx, "breakout", "WATCH", [
        `Price is testing support ${sup.price.toFixed(2)} (${sup.touches} touches)`,
        "Breakdown not confirmed — no close below the level yet",
      ]);
    }
    return sig(ctx, "breakout", "WAIT", ["Price is inside the detected range"]);
  },
};

export const srStrategy: StrategyDef = {
  id: "sr",
  name: "Support / Resistance Reaction",
  description: "Looks for reactions at strong levels against the prevailing trend. Informational only.",
  evaluate(ctx) {
    const c = ctx.lastClose;
    const tol = 0.0022;
    const sup = ctx.levels.filter((l) => l.kind === "support").sort((a, b) => b.price - a.price)[0];
    const res = ctx.levels.filter((l) => l.kind === "resistance").sort((a, b) => a.price - b.price)[0];
    if (sup && near(c, sup.price, tol) && ctx.trend !== "BEARISH") {
      const stop = sup.price * 0.996;
      const entry = c;
      const target = res ? res.price * 0.999 : entry + 2 * (entry - stop);
      return sig(ctx, "sr", "LONG_SETUP", [
        `Price reacting at support ${sup.price.toFixed(2)} (strength ${(sup.strength * 100).toFixed(0)}%)`,
        `Trend filter: ${ctx.trend}`,
      ], { entry, stop, target });
    }
    if (res && near(c, res.price, tol) && ctx.trend !== "BULLISH") {
      const stop = res.price * 1.004;
      const entry = c;
      const target = sup ? sup.price * 1.001 : entry - 2 * (stop - entry);
      return sig(ctx, "sr", "SHORT_SETUP", [
        `Price reacting at resistance ${res.price.toFixed(2)} (strength ${(res.strength * 100).toFixed(0)}%)`,
        `Trend filter: ${ctx.trend}`,
      ], { entry, stop, target });
    }
    return sig(ctx, "sr", "WAIT", ["Price is not at a strong detected level"]);
  },
};

export const ALL_STRATEGIES: StrategyDef[] = [trendStrategy, breakoutStrategy, srStrategy];
