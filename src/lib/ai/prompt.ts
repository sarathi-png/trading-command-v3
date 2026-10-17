/**
 * Prompt construction and answer validation.
 *
 * The model is a language model, not a calculator: everything numeric it needs
 * is handed to it pre-computed, and everything it returns must survive a strict
 * validator before it reaches the UI or the ledger. A malformed answer is a
 * rejected answer, never a half-parsed one — a prediction is a claim the user
 * may act on, so guessing at the model's intent is not acceptable.
 */
import type { AiChartType, AiContext, AiDirection, AiRawPrediction } from "./types";
import { AI_DEFAULT_HORIZON_BARS, isDirectional } from "./types";

export interface ValidatedPrediction {
  direction: AiDirection;
  confidence: number;
  horizonBars: number;
  rationale: string;
  invalidation: number | null;
  keyLevels: { support: number | null; resistance: number | null };
}

export type ValidationResult =
  | { ok: true; value: ValidatedPrediction }
  | { ok: false; error: string };

export function systemPrompt(): string {
  return [
    "You are a technical-analysis assistant inside a trading dashboard.",
    "You are given pre-computed indicator values for a 5-minute chart. Use only those numbers; never invent prices.",
    "Respond with a single JSON object and nothing else. No markdown, no prose outside the JSON.",
    "Schema:",
    '{"direction":"LONG"|"SHORT"|"NEUTRAL","confidence":<integer 0-100>,"horizonBars":<integer 1-20>,',
    '"rationale":"<max 600 chars, plain English, name the indicators you used>",',
    '"invalidation":<price that proves the call wrong>|null,"keyLevels":{"support":<price>|null,"resistance":<price>|null}}',
    "Rules:",
    "- Technical pattern matches are hypotheses, not guaranteed reversals. Use the explicit strategy checks, state conflicts and missing values. ADX is strength, not direction.",
    "- Memory is historical model-call outcomes sharing a pattern, not a pattern win rate. Never infer confidence or 80% accuracy from it. Do not claim learning or independent votes from correlated indicators.",
    "- confidence is your own stated certainty, not a probability. Be modest: 50-70 is a normal reading, above 80 needs exceptional agreement.",
    "- For LONG, invalidation must be BELOW the decision price. For SHORT, ABOVE it. For NEUTRAL, use null.",
    "- Say NEUTRAL when the indicators conflict. A forced call is worse than an honest no-call.",
    "- Never mention guaranteed returns, profit targets you cannot justify from the given levels, or financial advice.",
    "- rationale must reference the Chandelier Exit level, the Donchian bounds, or the Heikin-Ashi colour you were given.",
  ].join("\n");
}

export function userPrompt(context: AiContext): string {
  const lines: string[] = [];
  lines.push(`Instrument: ${context.symbol} · timeframe ${context.timeframe} · chart ${context.chartType === "heikin-ashi" ? "Heikin-Ashi (smoothed)" : "candlestick"}`);
  lines.push(`Closed candles analysed: ${context.bars}`);
  lines.push(`Decision bar (last closed 5m candle) close: ${context.lastClose}`);
  if (context.atr !== null) lines.push(`ATR(${context.atrLength ?? "length not recorded"}): ${context.atr}${context.atrPct !== null ? ` (${context.atrPct}% of price)` : ""}`);
  lines.push(
    `Chandelier Exit (ATR length ${context.atrLength ?? "unrecorded"}, multiplier ${context.chandelierMultiplier ?? "unrecorded"}): trend ${context.chandelier.trend ?? "none"}, signal ${context.chandelier.signal}, ` +
    `long stop ${context.chandelier.longStop ?? "n/a"}, short stop ${context.chandelier.shortStop ?? "n/a"}` +
    (context.chandelier.stopDistanceAtr !== null ? `, active stop ${context.chandelier.stopDistanceAtr} ATR away` : "")
  );
  const donchianRows = Object.entries(context.donchian.periods)
    .map(([p, v]) => `${p}: ${v.lower} – ${v.upper} (mid ${v.middle})`);
  lines.push(`Donchian ribbon trend: ${context.donchian.trend}; price outside ${context.donchian.alignedPeriods} of ${donchianRows.length} bounds`);
  if (donchianRows.length) lines.push(`Donchian bounds: ${donchianRows.join("; ")}`);
  lines.push(`Heikin-Ashi colour: ${context.heikinAshi.color ?? "n/a"} (${context.heikinAshi.consecutive} consecutive)`);
  lines.push(
    `Last 20 candles: change ${context.priceAction.changePct}%, range ${context.priceAction.rangeLow} – ${context.priceAction.rangeHigh}, ` +
    `${context.priceAction.higherHighs} higher highs, ${context.priceAction.lowerLows} lower lows`
  );
  if (context.technical) lines.push(`Technical evidence (raw closed candles, even for Heikin-Ashi display): ${JSON.stringify(context.technical)}`);
  if (context.memory) lines.push(`Comparable recorded memory: ${JSON.stringify(context.memory)}`);
  lines.push(`Predict the next ${AI_DEFAULT_HORIZON_BARS} candles (30 minutes). Return the JSON object only.`);
  return lines.join("\n");
}

/** Pull the first JSON object out of a model answer, tolerating code fences. */
export function extractJson(text: string): unknown {
  if (!text) throw new Error("Empty model response");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("No JSON object in model response");
  return JSON.parse(candidate.slice(start, end + 1));
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9eE+\-.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Validate a raw model answer against the schema AND against the market it is
 * describing. The geometric checks matter: a LONG call whose invalidation sits
 * above the entry price is internally contradictory and is rejected outright.
 */
export function validatePrediction(raw: unknown, context: AiContext): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Model response was not an object" };
  const r = raw as AiRawPrediction;

  const directionRaw = typeof r.direction === "string" ? r.direction.trim().toUpperCase() : "";
  if (directionRaw !== "LONG" && directionRaw !== "SHORT" && directionRaw !== "NEUTRAL") {
    return { ok: false, error: `Unrecognised direction: ${String(r.direction).slice(0, 20)}` };
  }
  const direction = directionRaw as AiDirection;

  const confidence = num(r.confidence);
  if (confidence === null) return { ok: false, error: "Missing or non-numeric confidence" };
  const confidenceClamped = Math.max(0, Math.min(100, Math.round(confidence)));

  const horizon = num((r as { horizonBars?: unknown }).horizonBars) ?? AI_DEFAULT_HORIZON_BARS;
  const horizonBars = Math.max(1, Math.min(20, Math.round(horizon)));

  const rationale = typeof r.rationale === "string" ? r.rationale.trim().replace(/\s+/g, " ") : "";
  if (rationale.length < 20) return { ok: false, error: "Rationale too short to be reviewable" };
  // 600, not 400: a genuine multi-indicator technical rationale (Chandelier +
  // Donchian + Heikin-Ashi + EMA/MACD conflicts) routinely runs past 400 chars.
  // Rejecting a well-reasoned call over a tight length cap threw away good
  // predictions; the cap still bounds runaway output and keeps the text
  // reviewable in the UI.
  if (rationale.length > 600) return { ok: false, error: "Rationale exceeds 600 characters" };

  const support = num(r.keyLevels?.support ?? null);
  const resistance = num(r.keyLevels?.resistance ?? null);
  const invalidation = num(r.invalidation ?? null);

  if (direction !== "NEUTRAL") {
    if (invalidation === null) return { ok: false, error: "Directional call without an invalidation price" };
    const price = context.lastClose;
    if (direction === "LONG" && invalidation >= price) {
      return { ok: false, error: "LONG invalidation is not below the decision price" };
    }
    if (direction === "SHORT" && invalidation <= price) {
      return { ok: false, error: "SHORT invalidation is not above the decision price" };
    }
    // Sanity band: an invalidation more than 25% away cannot be managed on a
    // 5-minute chart and is almost certainly a hallucinated number.
    if (Math.abs(invalidation - price) / price > 0.25) {
      return { ok: false, error: "Invalidation is implausibly far from the decision price" };
    }
  }

  return {
    ok: true,
    value: {
      direction,
      confidence: confidenceClamped,
      horizonBars,
      rationale,
      invalidation: direction === "NEUTRAL" ? null : invalidation,
      keyLevels: { support, resistance },
    },
  };
}

export function directionIsDirectional(direction: AiDirection): boolean {
  return isDirectional({ direction } as { direction: AiDirection });
}

/** Short line shown under a degraded (rule-engine) answer. */
export function degradationNotice(reason: string, providerLabel: string): string {
  return `${providerLabel} unavailable — ${reason}. Showing the built-in Chandelier + Donchian rule engine instead; this is a fixed algorithm, not a model response.`;
}

export function chartTypeLabel(chartType: AiChartType): string {
  return chartType === "heikin-ashi" ? "Heikin-Ashi" : "Candlestick";
}
