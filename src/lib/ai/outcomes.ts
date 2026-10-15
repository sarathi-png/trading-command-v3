/**
 * Scoring for AI predictions.
 *
 * A prediction is a claim, and a claim without a scoreboard is marketing. Once
 * enough 5-minute candles have printed after a prediction's decision bar, this
 * module decides what actually happened — again purely from candles, with no
 * network and no clock, so the result is reproducible.
 *
 * Deliberately conservative:
 *   - if price trades through the prediction's own invalidation level before
 *     the horizon, the call is recorded as WRONG regardless of where price ends
 *     up. Hitting your own stop is being wrong, even if the day recovers.
 *   - a move smaller than 0.05% is scored as "no-call": calling a coin flip a
 *     win is how a scoreboard lies.
 *   - NEUTRAL predictions never count as hits; they are tracked separately as
 *     abstentions.
 */
import type { Candle } from "@/lib/types";
import type { AiOutcome, AiPrediction } from "./types";

/** Moves smaller than this are treated as noise rather than a right/wrong call. */
export const AI_NOISE_THRESHOLD_PCT = 0.05;

export function predictOutcome(prediction: AiPrediction, candles: Candle[]): AiOutcome {
  const horizon = prediction.horizonBars;
  const index = candles.findIndex((c) => c.time * 1000 === prediction.barTime);
  const afterwards = index >= 0 ? candles.slice(index + 1) : [];

  if (index < 0) {
    return { resolution: "pending", bars: 0, priceAtHorizon: null, movePct: null, invalidationHit: false };
  }
  if (afterwards.length < horizon) {
    return {
      resolution: "pending",
      bars: afterwards.length,
      priceAtHorizon: afterwards.length ? afterwards[afterwards.length - 1].close : null,
      movePct: null,
      invalidationHit: false,
    };
  }

  const window = afterwards.slice(0, horizon);
  const entry = prediction.entryPrice;
  const directional = prediction.direction === "LONG" || prediction.direction === "SHORT";

  let invalidationHit = false;
  if (directional && prediction.invalidation !== null) {
    const level = prediction.invalidation;
    invalidationHit = window.some((c) =>
      prediction.direction === "LONG" ? c.low <= level : c.high >= level
    );
  }

  const finalClose = window[window.length - 1].close;
  const movePct = entry !== 0 ? ((finalClose - entry) / entry) * 100 : 0;
  const signed = prediction.direction === "SHORT" ? -movePct : movePct;

  if (!directional) {
    return {
      resolution: "no-call",
      bars: horizon,
      priceAtHorizon: finalClose,
      movePct: Number(movePct.toFixed(4)),
      invalidationHit,
    };
  }

  if (invalidationHit) {
    return {
      resolution: "direction-wrong",
      bars: horizon,
      priceAtHorizon: finalClose,
      movePct: Number(movePct.toFixed(4)),
      invalidationHit: true,
    };
  }

  if (Math.abs(movePct) < AI_NOISE_THRESHOLD_PCT) {
    return {
      resolution: "no-call",
      bars: horizon,
      priceAtHorizon: finalClose,
      movePct: Number(movePct.toFixed(4)),
      invalidationHit: false,
    };
  }

  return {
    resolution: signed > 0 ? "direction-correct" : "direction-wrong",
    bars: horizon,
    priceAtHorizon: finalClose,
    movePct: Number(movePct.toFixed(4)),
    invalidationHit: false,
  };
}

export interface AiScorecard {
  total: number;
  resolved: number;
  pending: number;
  /** Directional calls that were scored (correct + wrong). */
  scored: number;
  correct: number;
  wrong: number;
  /** correct / scored, or null when nothing has been scored yet. */
  hitRate: number | null;
  /** Share of scored directional calls whose own invalidation level was hit. */
  invalidationRate: number | null;
  abstentions: number;
  avgConfidence: number | null;
  byProvider: Array<{
    provider: string;
    total: number;
    scored: number;
    correct: number;
    hitRate: number | null;
    avgConfidence: number | null;
  }>;
  byChartType: Array<{ chartType: string; total: number; scored: number; correct: number; hitRate: number | null }>;
  /** Small-sample warning the UI must show while the numbers mean little. */
  note: string;
}

function rate(correct: number, scored: number): number | null {
  return scored > 0 ? correct / scored : null;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
}

/** Aggregate a set of predictions into a scorecard. Pure. */
export function scorecard(predictions: AiPrediction[]): AiScorecard {
  const withOutcome = (p: AiPrediction): AiOutcome | null => p.outcome;
  const resolved = predictions.filter((p) => withOutcome(p) && p.outcome!.resolution !== "pending");
  const scoredRows = resolved.filter((p) => p.outcome!.resolution === "direction-correct" || p.outcome!.resolution === "direction-wrong");
  const correct = scoredRows.filter((p) => p.outcome!.resolution === "direction-correct").length;
  const wrong = scoredRows.length - correct;
  const invalidationHits = scoredRows.filter((p) => p.outcome!.invalidationHit).length;
  const abstentions = resolved.filter((p) => p.outcome!.resolution === "no-call").length;

  const providerIds = [...new Set(predictions.map((p) => p.provider))];
  const byProvider = providerIds.map((provider) => {
    const rows = predictions.filter((p) => p.provider === provider);
    const scored = rows.filter((p) => p.outcome && (p.outcome.resolution === "direction-correct" || p.outcome.resolution === "direction-wrong"));
    const providerCorrect = scored.filter((p) => p.outcome!.resolution === "direction-correct").length;
    return {
      provider,
      total: rows.length,
      scored: scored.length,
      correct: providerCorrect,
      hitRate: rate(providerCorrect, scored.length),
      avgConfidence: mean(rows.filter((p) => p.direction !== "NEUTRAL").map((p) => p.confidence)),
    };
  });

  const chartTypes = [...new Set(predictions.map((p) => p.chartType))];
  const byChartType = chartTypes.map((chartType) => {
    const rows = predictions.filter((p) => p.chartType === chartType);
    const scored = rows.filter((p) => p.outcome && (p.outcome.resolution === "direction-correct" || p.outcome.resolution === "direction-wrong"));
    const chartCorrect = scored.filter((p) => p.outcome!.resolution === "direction-correct").length;
    return { chartType, total: rows.length, scored: scored.length, correct: chartCorrect, hitRate: rate(chartCorrect, scored.length) };
  });

  const note = scoredRows.length < 20
    ? `Only ${scoredRows.length} directional call${scoredRows.length === 1 ? "" : "s"} scored so far — far too few to say anything about skill. Treat this as a log, not a track record.`
    : "Scored from published calls, not from executed trades. Past behaviour of any model is not evidence about the future.";

  return {
    total: predictions.length,
    resolved: resolved.length,
    pending: predictions.length - resolved.length,
    scored: scoredRows.length,
    correct,
    wrong,
    hitRate: rate(correct, scoredRows.length),
    invalidationRate: rate(invalidationHits, scoredRows.length),
    abstentions,
    avgConfidence: mean([...scoredRows, ...resolved.filter((p) => p.outcome!.resolution === "no-call" && p.direction !== "NEUTRAL")].map((p) => p.confidence)),
    byProvider,
    byChartType,
    note,
  };
}
