/** Retrieval from recorded, matured calls, not model training or invented recall. */
import type { AiContext, AiPrediction } from "./types";
import { TF_MINUTES, type Timeframe } from "../types";
export interface PatternMemory {
  matching: number;
  correct: number;
  wrong: number;
  noMove: number;
  examples: string[];
  note: string;
}
export function recallMemory(
  context: AiContext,
  rows: AiPrediction[],
): PatternMemory {
  const names = new Set(
    context.technical?.patterns
      .filter((p) => p.bias !== "neutral")
      .map((p) => p.name) ?? [],
  );
  const matches = rows
    .filter(
      (p) =>
        context.dataSource !== undefined &&
        p.context.dataSource === context.dataSource &&
        p.symbol === context.symbol &&
        p.timeframe === context.timeframe &&
        p.chartType === context.chartType &&
        p.context.technical?.version === context.technical?.version &&
        p.barTime +
          p.horizonBars * (TF_MINUTES[p.timeframe as Timeframe] ?? 5) * 60_000 <
          context.lastBarTime &&
        p.direction !== "NEUTRAL" &&
        p.outcome &&
        p.outcome.resolution !== "pending" &&
        p.context.technical?.patterns.some((x) => names.has(x.name)),
    )
    .sort((a, b) => a.barTime - b.barTime);
  // Multiple providers, forced refreshes and overlapping horizons aren't independent examples.
  const unique: AiPrediction[] = [];
  for (const row of matches) {
    const prior = unique.at(-1);
    if (
      prior &&
      row.barTime <=
        prior.barTime +
          prior.horizonBars *
            (TF_MINUTES[prior.timeframe as Timeframe] ?? 5) *
            60_000
    )
      continue;
    unique.push(row);
  }
  return {
    matching: unique.length,
    correct: unique.filter((p) => p.outcome?.resolution === "direction-correct")
      .length,
    wrong: unique.filter((p) => p.outcome?.resolution === "direction-wrong")
      .length,
    noMove: unique.filter((p) => p.outcome?.resolution === "no-call").length,
    examples: unique.slice(-3).map((p) => p.id),
    note:
      unique.length < 20
        ? "Insufficient comparable recorded outcomes (fewer than 20). No confidence boost."
        : "Descriptive history of model calls sharing a pattern, not a pattern win rate or a probability. No confidence boost.",
  };
}
