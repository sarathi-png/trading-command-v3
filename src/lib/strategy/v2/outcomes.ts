/**
 * Signal accountability: what happened *after* a recorded setup.
 *
 * Popular retail terminals record signals and forget them. Recomputing the
 * outcome of every recorded setup from candle history turns a stream of
 * claims into a scoreboard the user can hold the strategy to — and it is
 * deliberately descriptive: it measures the plan that was published (entry,
 * stop, target), never a promise about future performance.
 *
 * Pure functions only: no database, no clock, no network, so the arithmetic is
 * unit-testable and identical everywhere it is used.
 */
import type { Candle } from "@/lib/types";

export interface RecordedSetup {
  /** LONG_SETUP or SHORT_SETUP; anything else has no directional outcome. */
  status: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** Signal timestamp in milliseconds (signal candle's open time × 1000). */
  ts: number;
}

export type SetupResolution = "target" | "stop" | "open" | "unknown";

export interface SetupOutcome {
  side: "long" | "short" | null;
  /** Closed candles available after the signal. */
  bars: number;
  resolution: SetupResolution;
  barsToResolution: number | null;
  /** Maximum favourable excursion in R (>= 0). */
  mfeR: number | null;
  /** Maximum adverse excursion in R (>= 0). */
  maeR: number | null;
  /** Result at the last available close, in R. */
  currentR: number | null;
  lastPrice: number | null;
  /** Present when resolution is "unknown" — why it could not be evaluated. */
  reason?: string;
}

function unknown(reason: string, side: "long" | "short" | null = null): SetupOutcome {
  return {
    side,
    bars: 0,
    resolution: "unknown",
    barsToResolution: null,
    mfeR: null,
    maeR: null,
    currentR: null,
    lastPrice: null,
    reason,
  };
}

export function sideOf(status: string): "long" | "short" | null {
  if (status === "LONG_SETUP") return "long";
  if (status === "SHORT_SETUP") return "short";
  return null;
}

export function evaluateSetupOutcome(setup: RecordedSetup, candles: Candle[]): SetupOutcome {
  const side = sideOf(setup.status);
  if (!side) return unknown("Only LONG_SETUP / SHORT_SETUP rows have a directional outcome");

  const { entry, stop, target } = setup;
  if (entry === null || stop === null || !Number.isFinite(entry) || !Number.isFinite(stop) || entry <= 0 || stop <= 0) {
    return unknown("The recorded setup has no usable entry and stop", side);
  }
  const risk = side === "long" ? entry - stop : stop - entry;
  if (!(risk > 0)) return unknown("The recorded stop is on the wrong side of the entry", side);

  const hasTarget = target !== null && Number.isFinite(target) && target > 0;
  const targetR = hasTarget ? (side === "long" ? target - entry : entry - target) / risk : null;
  // A target beyond the entry on the wrong side would be "hit" by almost any
  // candle. Treat the recorded plan as malformed instead of inventing a result.
  if (targetR !== null && !(targetR > 0)) {
    return unknown(`${side === "long" ? "Long" : "Short"} target is on the wrong side of the entry`, side);
  }

  // Candles strictly after the signal candle. The signal timestamp is the open
  // time of the candle that has just closed, so a candle with time > ts is the
  // first bar a trader could actually act on.
  const forward = candles.filter((c) => c.time * 1000 > setup.ts);
  if (forward.length === 0) return unknown("No candle history covers this setup yet", side);

  let mfeR = 0;
  let maeR = 0;
  let bars = 0;

  for (const candle of forward) {
    bars += 1;
    const favourable = side === "long" ? candle.high - entry : entry - candle.low;
    const adverse = side === "long" ? entry - candle.low : candle.high - entry;
    mfeR = Math.max(mfeR, favourable / risk);
    maeR = Math.max(maeR, adverse / risk);

    const stopHit = side === "long" ? candle.low <= stop : candle.high >= stop;
    // Conservative same-candle rule: if both levels are touched, assume the
    // stop filled first. Intrabar sequencing is unknowable from OHLC alone.
    if (stopHit) {
      return { side, bars, resolution: "stop", barsToResolution: bars, mfeR, maeR, currentR: -1, lastPrice: stop };
    }
    const targetHit = hasTarget && (side === "long" ? candle.high >= target : candle.low <= target);
    if (targetHit) {
      return { side, bars, resolution: "target", barsToResolution: bars, mfeR, maeR, currentR: targetR, lastPrice: target };
    }
  }

  const lastPrice = forward[forward.length - 1].close;
  const currentR = (side === "long" ? lastPrice - entry : entry - lastPrice) / risk;
  return { side, bars, resolution: "open", barsToResolution: null, mfeR, maeR, currentR, lastPrice };
}

export interface OutcomeSummary {
  recorded: number;
  evaluated: number;
  unresolved: number;
  targetHits: number;
  stopHits: number;
  open: number;
  /** targetHits / (targetHits + stopHits), or null when nothing resolved. */
  hitRate: number | null;
  /** Mean result of resolved setups in R (target → +targetR, stop → −1). */
  avgResolvedR: number | null;
  avgMfeR: number | null;
  avgMaeR: number | null;
}

const mean = (values: number[]): number | null =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function summariseOutcomes(outcomes: SetupOutcome[]): OutcomeSummary {
  const evaluated = outcomes.filter((o) => o.resolution !== "unknown");
  const targetHits = evaluated.filter((o) => o.resolution === "target").length;
  const stopHits = evaluated.filter((o) => o.resolution === "stop").length;
  const openCount = evaluated.filter((o) => o.resolution === "open").length;
  const resolvedR = evaluated
    .filter((o) => (o.resolution === "target" || o.resolution === "stop") && o.currentR !== null)
    .map((o) => o.currentR as number);
  const round = (v: number | null) => (v === null ? null : Number(v.toFixed(2)));

  return {
    recorded: outcomes.length,
    evaluated: evaluated.length,
    unresolved: outcomes.length - evaluated.length,
    targetHits,
    stopHits,
    open: openCount,
    hitRate: targetHits + stopHits > 0 ? Number(((targetHits / (targetHits + stopHits)) * 100).toFixed(1)) : null,
    avgResolvedR: round(mean(resolvedR)),
    avgMfeR: round(mean(evaluated.map((o) => o.mfeR ?? 0))),
    avgMaeR: round(mean(evaluated.map((o) => o.maeR ?? 0))),
  };
}
