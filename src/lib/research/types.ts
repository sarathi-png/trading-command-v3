/**
 * AI-assisted strategy research — shared types.
 *
 * The model is asked to produce ONE JSON object describing a strategy
 * hypothesis. Everything it returns is untrusted input: it is validated
 * here against strict allowlists and ranges before anything else sees
 * it, and it is NEVER executed. The only path from a research report to
 * a trade is a validated `ChandelierDonchianConfig` consumed by the
 * existing, trusted backtesting and paper-trading engines.
 *
 * Honesty rules baked into the types:
 *   - a report is a hypothesis. `backtest` results are the only verified
 *     numbers, and they are historical, not predictions.
 *   - `strategyConfig` is null unless the hypothesis maps onto the
 *     executable engine; otherwise `compatibility` says why.
 */

/** Indicators the research layer recognises. Anything else is rejected. */
export const RESEARCH_INDICATORS = [
  "ema", "sma", "rsi", "macd", "bollinger", "donchian",
  "chandelier", "atr", "volume",
] as const;
export type ResearchIndicatorType = (typeof RESEARCH_INDICATORS)[number];

export interface ResearchIndicator {
  type: ResearchIndicatorType;
  /** Lookback length in candles, where the indicator has one. */
  period?: number;
  /** Extra validated parameters (e.g. bollinger stdDev). */
  params?: Record<string, number>;
  role: string; // what the indicator is being asked to do
}

/** Strategy families the operator can pick from. */
export const RESEARCH_STRATEGY_TYPES = [
  "chandelier-donchian", // the engine's executable strategy
  "trend",
  "breakout",
  "sr",
  "concept", // a new idea the model should design from scratch
] as const;
export type ResearchStrategyType = (typeof RESEARCH_STRATEGY_TYPES)[number];

export interface ResearchRequest {
  symbol: string;
  timeframe: string;
  strategyType: ResearchStrategyType;
  /** Plain-English objective, 10..2000 chars. */
  objective: string;
  /** Optional extra constraints in plain English. */
  constraints?: string;
  /** Provider override; "auto" prefers a configured provider. */
  provider?: string;
  /** Set when this run revises an earlier one. */
  revisionOf?: string | null;
}

/**
 * The structured report. Every string field is bounded; every list is
 * bounded; the model cannot smuggle unbounded content past validation.
 */
export interface ResearchReport {
  summary: string;
  hypothesis: string;
  marketAssumptions: string;
  entryRules: string[];
  exitRules: string[];
  indicators: ResearchIndicator[];
  stopLossLogic: string;
  takeProfitLogic: string;
  positionSizing: string;
  recommendedBars: number;
  recommendedPeriodRationale: string;
  riskFactors: string[];
  overfittingConcerns: string[];
  validationSteps: string[];
  /**
   * The executable strategy configuration, when the hypothesis maps onto
   * the Chandelier Exit + Donchian Ribbon engine. Null otherwise — the
   * report stays readable, but nothing executable is invented.
   */
  strategyConfig: import("../strategy/v2/types").ChandelierDonchianConfig | null;
  /** "executable" = strategyConfig is present and validated. */
  compatibility: "executable" | "research-only";
  /** Validation/clamping notes the operator must see. */
  warnings: string[];
}

export interface ResearchRun {
  id: string;
  workspace: string;
  symbol: string;
  timeframe: string;
  strategyType: ResearchStrategyType;
  objective: string;
  constraints: string;
  provider: string;
  model: string;
  status: "completed" | "failed";
  report: ResearchReport | null;
  /** The exact market evidence the model was shown, for replay. */
  marketEvidence: Record<string, unknown> | null;
  error: string | null;
  revisionOf: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Insert payload: ids/timestamps are optional. */
export type ResearchRunInsert = Omit<ResearchRun, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

/* ---------------- backtest jobs ---------------- */

export type BacktestJobStatus = "queued" | "running" | "completed" | "failed";

export interface BacktestSegment {
  /** Candle-window index this segment covers: [startIndex, endIndex). */
  startIndex: number;
  endIndex: number;
  label: string;
  status: "pending" | "done" | "failed";
}

export interface BacktestJob {
  id: string;
  /** Deterministic key deduplicating retried/duplicate requests. */
  idempotencyKey: string;
  workspace: string;
  symbol: string;
  timeframe: string;
  config: import("../strategy/v2/types").ChandelierDonchianConfig;
  capital: number;
  feeRate: number;
  slippage: number;
  /** How many recent closed candles to load (bounded). */
  candleLimit: number;
  walkForward: boolean;
  trainWindow: number | null;
  testWindow: number | null;
  status: BacktestJobStatus;
  segmentsTotal: number;
  segmentsDone: number;
  /** Aggregated metrics once every segment is done. */
  result: import("../strategy/v2/types").BacktestResult | null;
  /** Per-fold results for walk-forward runs. */
  segmentResults: import("../strategy/v2/types").BacktestResult[] | null;
  dataWarnings: string[];
  fillModel: string;
  researchRunId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export type BacktestJobInsert = Omit<BacktestJob, "id" | "createdAt" | "updatedAt" | "startedAt" | "completedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
};

/** How the app describes its execution assumptions, verbatim. */
export const FILL_MODEL_DESCRIPTION =
  "Closed-bar signals; orders fill at the NEXT real candle's open; trailing stops are evaluated on the prior bar and a gap through the stop fills at the worse opening price; fees and slippage are charged per side at the configured rates. No synthetic fills, no intra-bar price invention.";

/** Short alias for the fill-model description. */
export const FILL_MODEL = FILL_MODEL_DESCRIPTION;
