import type { AiPrediction } from "../ai/types";
export interface PredictionContext {
  id: string;
  provider: string;
  model: string;
  chartType: string;
  timeframe: string;
  direction: string;
  createdAt: number;
  rationale: string;
  agrees: boolean;
  attribution: "prior-context-only";
}
/** Never hindsight-match, cross demo/live sources, or claim execution attribution. */
export function priorPredictionContext(predictions: AiPrediction[], symbol: string, direction: "long" | "short", openedAt: number, source: "demo" | "live"): PredictionContext[] {
  const selected = new Set<string>();
  return [...predictions].sort((a,b) => b.createdAt - a.createdAt).filter(p => {
    const minutes = Number(p.timeframe.replace("m", ""));
    const valid = p.symbol === symbol && p.context.dataSource === source && p.createdAt <= openedAt && p.createdAt >= p.barTime + minutes * 60_000
      && openedAt - p.createdAt <= Math.min(30, p.horizonBars * minutes) * 60_000
      && Number.isFinite(minutes) && minutes > 0 && (p.direction === "LONG" || p.direction === "SHORT");
    const key = `${p.provider}:${p.chartType}`;
    if (!valid || selected.has(key)) return false;
    selected.add(key); return true;
  }).map(p => ({ id: p.id, provider: p.provider, model: p.model, chartType: p.chartType, timeframe: p.timeframe, direction: p.direction,
    createdAt: p.createdAt, rationale: p.rationale, agrees: p.direction.toLowerCase() === direction, attribution: "prior-context-only" }));
}
export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}
