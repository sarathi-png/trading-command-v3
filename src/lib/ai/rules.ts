/**
 * Built-in rule engine — the predictor that always works.
 *
 * Two jobs:
 *   1. It is the fallback when no API key is configured, when the free tier is
 *      rate-limited, or when a model returns something unusable. A feature that
 *      silently disappears without keys would be worse than a feature that
 *      degrades and says so.
 *   2. It is the baseline the model has to beat. Both are recorded in the same
 *      ledger, so after a few dozen calls the user can see whether paying for a
 *      model would actually change anything.
 *
 * It reads exactly the two indicators the user asked for: Chandelier Exit
 * (trailing stop + trend) and the Donchian ribbon (trend alignment), plus
 * Heikin-Ashi colour as the confirmation the strategy engine already uses.
 */
import type { AiContext, AiDirection, AiPrediction } from "./types";

export interface RuleVerdict {
  direction: AiDirection;
  confidence: number;
  rationale: string;
  invalidation: number | null;
  keyLevels: { support: number | null; resistance: number | null };
  /** Which of the three checks voted, and how strongly, for the UI to show. */
  votes: { chandelier: number; donchian: number; heikinAshi: number };
}

function nearestLower(levels: number[], price: number): number | null {
  const below = levels.filter((l) => Number.isFinite(l) && l < price);
  return below.length ? Math.max(...below) : null;
}

function nearestHigher(levels: number[], price: number): number | null {
  const above = levels.filter((l) => Number.isFinite(l) && l > price);
  return above.length ? Math.min(...above) : null;
}

/**
 * Deterministic verdict from the indicator snapshot. No clock, no randomness —
 * the same snapshot always yields the same call, which is what makes it
 * reviewable.
 */
export function ruleVerdict(context: AiContext): RuleVerdict {
  const { lastClose } = context;

  // Chandelier vote: trend direction, with a live trailing stop behind it.
  const chandelierVote: number =
    context.chandelier.signal === "buy" ? 1 : context.chandelier.signal === "sell" ? -1 : 0;

  // Donchian vote has two strengths, because the ribbon's trend flag is sticky:
  // it reports the established trend, while `alignedPeriods` reports whether
  // price is outside the bounds *right now*. A trend that was established and
  // has since pulled back inside the ribbon is real but weaker than a live
  // breakout, and the two must not be scored the same.
  const totalPeriods = Object.keys(context.donchian.periods).length;
  const fullyAligned = totalPeriods > 0 && context.donchian.alignedPeriods >= totalPeriods;
  const established = context.donchian.trend === "green" || context.donchian.trend === "red";
  let donchianVote = 0;
  if (fullyAligned) donchianVote = context.donchian.trend === "red" ? -1 : 1;
  else if (established) donchianVote = context.donchian.trend === "green" ? 0.5 : -0.5;

  // Heikin-Ashi vote: colour, and only trusted with a streak of 2+ (the same
  // "wait for the smoothed series to agree" rule the strategy uses).
  let haVote = 0;
  if (context.heikinAshi.color === "green" && context.heikinAshi.consecutive >= 2) haVote = 1;
  else if (context.heikinAshi.color === "red" && context.heikinAshi.consecutive >= 2) haVote = -1;

  const score = chandelierVote + donchianVote + haVote;

  const upperLevels = Object.values(context.donchian.periods).map((p) => p.upper);
  const lowerLevels = Object.values(context.donchian.periods).map((p) => p.lower);
  const support = nearestLower([...lowerLevels, context.priceAction.rangeLow], lastClose);
  const resistance = nearestHigher([...upperLevels, context.priceAction.rangeHigh], lastClose);

  const votes = { chandelier: chandelierVote, donchian: donchianVote, heikinAshi: haVote };
  const strength = Math.abs(score);

  const parts: string[] = [];
  parts.push(
    chandelierVote === 1 ? "Chandelier: long trend, price above the trailing stop"
      : chandelierVote === -1 ? "Chandelier: short trend, price below the trailing stop"
      : "Chandelier: no active signal"
  );
  parts.push(
    donchianVote === 1 ? `Donchian: price above all ${totalPeriods} upper bounds — live green breakout`
      : donchianVote === -1 ? `Donchian: price below all ${totalPeriods} lower bounds — live red breakdown`
      : donchianVote > 0 ? `Donchian: ${context.donchian.trend} trend established earlier, price now back inside the ribbon`
      : donchianVote < 0 ? `Donchian: ${context.donchian.trend} trend established earlier, price now back inside the ribbon`
      : "Donchian: price inside the ribbon"
  );
  parts.push(
    haVote === 1 ? `Heikin-Ashi: ${context.heikinAshi.consecutive} green candles`
      : haVote === -1 ? `Heikin-Ashi: ${context.heikinAshi.consecutive} red candles`
      : "Heikin-Ashi: no colour streak"
  );
  if (context.atrPct !== null) parts.push(`ATR ${context.atrPct}% of price`);

  if (strength >= 2.5) {
    const direction: AiDirection = score > 0 ? "LONG" : "SHORT";
    const invalidation = direction === "LONG"
      ? context.chandelier.longStop ?? support
      : context.chandelier.shortStop ?? resistance;
    return {
      direction,
      confidence: 62,
      rationale: `All three checks agree. ${parts.join(". ")}.`,
      invalidation,
      keyLevels: { support, resistance },
      votes,
    };
  }

  if (strength >= 1.5) {
    const direction: AiDirection = score > 0 ? "LONG" : "SHORT";
    const invalidation = direction === "LONG"
      ? context.chandelier.longStop ?? support
      : context.chandelier.shortStop ?? resistance;
    return {
      direction,
      confidence: 45,
      rationale: `Two of three checks agree, one disagrees — a gap trade, not a clean setup. ${parts.join(". ")}.`,
      invalidation,
      keyLevels: { support, resistance },
      votes,
    };
  }

  // Conflicting or no signal: say so instead of guessing a direction.
  const bias: AiDirection = score === 0 ? "NEUTRAL" : score > 0 ? "LONG" : "SHORT";
  return {
    direction: bias === "NEUTRAL" ? "NEUTRAL" : "NEUTRAL",
    confidence: 30,
    rationale: `Indicators disagree, so there is no directional call. ${parts.join(". ")}.`,
    invalidation: null,
    keyLevels: { support, resistance },
    votes,
  };
}

/** Evidence lines the UI shows next to a rule-engine answer. */
export function ruleEvidence(context: AiContext): string[] {
  const lines: string[] = [];
  lines.push(
    context.chandelier.longStop !== null || context.chandelier.shortStop !== null
      ? `Chandelier trailing stop: long ${fmt(context.chandelier.longStop)} · short ${fmt(context.chandelier.shortStop)}`
      : "Chandelier trailing stop: not available yet (warming up)"
  );
  const periods = Object.entries(context.donchian.periods);
  if (periods.length) {
    lines.push(`Donchian bounds: ${periods.map(([p, v]) => `${p} → ${fmt(v.lower)} – ${fmt(v.upper)}`).join(" · ")}`);
  }
  lines.push(`Heikin-Ashi colour: ${context.heikinAshi.color ?? "n/a"} (${context.heikinAshi.consecutive} in a row)`);
  lines.push(`20-bar range: ${fmt(context.priceAction.rangeLow)} – ${fmt(context.priceAction.rangeHigh)}`);
  return lines;
}

function fmt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  return value >= 100 ? value.toFixed(2) : value.toFixed(4);
}

/** True when a stored prediction came from the rule engine. */
export function isRulePrediction(p: Pick<AiPrediction, "provider">): boolean {
  return p.provider === "rules";
}
