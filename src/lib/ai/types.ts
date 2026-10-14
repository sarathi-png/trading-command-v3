/**
 * AI signal prediction — shared types.
 *
 * The assistant can call external model providers (OpenRouter, NVIDIA NIM) or
 * fall back to a deterministic local rule engine. Whatever the source, the
 * output is forced into ONE schema so the UI, the audit trail and the outcome
 * scoreboard never depend on which model answered.
 *
 * Honesty rules baked into the types:
 *   - every prediction carries `provider`, `model` and a `notice` so a rule
 *     engine's answer can never masquerade as a large-model answer
 *   - `confidence` is the model's own self-reported number, clamped to 0-100;
 *     it is NOT a probability and the UI must say so
 *   - `invalidation` is required for directional calls, so a call always has a
 *     stated price at which it is simply wrong
 */

export const AI_PROVIDERS = ["openrouter", "nvidia", "rules"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const AI_CHART_TYPES = ["candles", "heikin-ashi"] as const;
export type AiChartType = (typeof AI_CHART_TYPES)[number];

export type AiDirection = "LONG" | "SHORT" | "NEUTRAL";

/** Indicator snapshot handed to the model — the evidence the call is based on. */
export interface AiContext {
  symbol: string;
  timeframe: string;
  chartType: AiChartType;
  /** Number of closed candles behind the snapshot. */
  bars: number;
  /** Open time of the last CLOSED candle, ms. The decision bar. */
  lastBarTime: number;
  lastClose: number;
  /** Wilder ATR(20) on the same series, or null when warming up. */
  atr: number | null;
  atrPct: number | null;
  chandelier: {
    trend: "long" | "short" | null;
    signal: "buy" | "sell" | "none";
    longStop: number | null;
    shortStop: number | null;
    /** Candle distance from the active trailing stop, in ATR units. */
    stopDistanceAtr: number | null;
  };
  donchian: {
    trend: "green" | "red" | "neutral";
    periods: Record<number, { upper: number; lower: number; middle: number }>;
    /** How many of the configured lookbacks the close is outside of (0-4). */
    alignedPeriods: number;
  };
  heikinAshi: { color: "green" | "red" | null; consecutive: number };
  priceAction: {
    changePct: number;
    rangeHigh: number;
    rangeLow: number;
    higherHighs: number;
    lowerLows: number;
  };
}

export interface AiKeyLevels {
  support: number | null;
  resistance: number | null;
}

/** A single model call, as stored and displayed. */
export interface AiPrediction {
  id: string;
  symbol: string;
  timeframe: string;
  chartType: AiChartType;
  provider: AiProviderId;
  model: string;
  direction: AiDirection;
  /** Self-reported confidence, 0-100. Not a probability. */
  confidence: number;
  /** How many 5m candles ahead the call is meant to hold. */
  horizonBars: number;
  /** Plain-language reasoning, <= 400 characters. */
  rationale: string;
  /** Price that voids the call, required for LONG/SHORT. */
  invalidation: number | null;
  keyLevels: AiKeyLevels;
  entryPrice: number;
  createdAt: number;
  /** Decision bar (open time of the last closed candle), ms. */
  barTime: number;
  context: AiContext;
  /** True when a rule engine answered instead of a model. */
  degraded: boolean;
  /** Why it degraded / any caveat the user must read. Never empty when degraded. */
  notice: string | null;
  /** Resolved once enough candles have printed after `barTime`. */
  outcome: AiOutcome | null;
}

export type AiResolution = "direction-correct" | "direction-wrong" | "no-call" | "pending";

export interface AiOutcome {
  resolution: AiResolution;
  /** Closed candles available after the decision bar. */
  bars: number;
  priceAtHorizon: number | null;
  /** Signed % move from the decision close (prediction direction applied). */
  movePct: number | null;
  /** True when price traded through the stated invalidation first. */
  invalidationHit: boolean;
}

/** What the model is asked to return (before validation). */
export interface AiRawPrediction {
  direction: string;
  confidence: number | string;
  rationale: string;
  invalidation?: number | string | null;
  keyLevels?: { support?: number | string | null; resistance?: number | string | null };
}

export interface AiProviderStatus {
  id: AiProviderId;
  label: string;
  /** True when a key is present (env or data/ai-keys.json). */
  configured: boolean;
  /** "env" | "file" | null — where the key came from. Never the key itself. */
  keySource: "env" | "file" | null;
  /** Last 4 characters of the key, for a "is this the right key?" check. */
  keyHint: string | null;
  model: string;
  /** Free-tier guard rails, surfaced so the user can see why a call was skipped. */
  callsToday: number;
  dailyLimit: number;
  minIntervalSeconds: number;
  /** Epoch ms of the last call, or null. */
  lastCallAt: number | null;
  /** Always available without any key. */
  alwaysOn: boolean;
}

/** Provider catalog. Model ids are free-tier-friendly defaults, overridable. */
export const AI_PROVIDER_CATALOG: Record<Exclude<AiProviderId, "rules">, { label: string; baseUrl: string; defaultModel: string; keyEnv: string[]; modelEnv: string; docsUrl: string }> = {
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    keyEnv: ["OPENROUTER_API_KEY", "OPENROUTER_KEY"],
    modelEnv: "OPENROUTER_MODEL",
    docsUrl: "https://openrouter.ai/docs",
  },
  nvidia: {
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1/chat/completions",
    defaultModel: "meta/llama-3.1-8b-instruct",
    keyEnv: ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY"],
    modelEnv: "NVIDIA_MODEL",
    docsUrl: "https://build.nvidia.com",
  },
};

export const RULES_PROVIDER_LABEL = "Built-in rule engine (Chandelier + Donchian)";

/** Default horizon: 6 × 5m = 30 minutes ahead. */
export const AI_DEFAULT_HORIZON_BARS = 6;
/** Free-tier guard rails. Conservative on purpose: a 429 is worse than a wait. */
export const AI_FREE_TIER_LIMITS: Record<Exclude<AiProviderId, "rules">, { dailyLimit: number; minIntervalSeconds: number }> = {
  openrouter: { dailyLimit: 90, minIntervalSeconds: 45 },
  nvidia: { dailyLimit: 180, minIntervalSeconds: 30 },
};

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

export function isAiChartType(value: unknown): value is AiChartType {
  return typeof value === "string" && (AI_CHART_TYPES as readonly string[]).includes(value);
}

export function isDirectional(p: Pick<AiPrediction, "direction">): boolean {
  return p.direction === "LONG" || p.direction === "SHORT";
}
