/**
 * Validation of AI research output.
 *
 * Everything in this module treats model output as untrusted input. The
 * model is never allowed to execute anything: its answer is parsed into
 * a plain object, checked field-by-field against strict allowlists and
 * ranges, and only then converted into a `ChandelierDonchianConfig` the
 * existing engine understands. Unknown keys, unknown indicator types,
 * out-of-range numbers and oversized strings are all rejected or clamped
 * with a visible warning — never silently accepted.
 */
import type { ChandelierDonchianConfig } from "../strategy/v2/types";
import {
  RESEARCH_INDICATORS,
  RESEARCH_STRATEGY_TYPES,
  type ResearchIndicator,
  type ResearchIndicatorType,
  type ResearchReport,
  type ResearchStrategyType,
} from "./types";
import { TIMEFRAMES, type Timeframe } from "../types";

export interface ValidationIssue {
  path: string;
  message: string;
  /** "rejected" fails the whole report; "clamped" was repaired in place. */
  severity: "rejected" | "clamped";
}

export interface ValidationResult {
  ok: boolean;
  report: ResearchReport | null;
  issues: ValidationIssue[];
}

const MAX_STR = 2000;
const MAX_LIST = 12;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : fallback;
}

/** Bounded, single-line string. Null when unusable. */
function boundedStr(v: unknown, max = MAX_STR): string | null {
  if (typeof v !== "string") return null;
  const clean = v.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.slice(0, max);
}

function strList(v: unknown, max = MAX_LIST): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = boundedStr(item, 400);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function intIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= min && r <= max ? r : null;
}

function numIn(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n >= min && n <= max ? n : null;
}

/** Indicator allowlist: type must be known, period must be in range. */
function validateIndicators(raw: unknown, issues: ValidationIssue[]): ResearchIndicator[] {
  if (!Array.isArray(raw)) return [];
  const out: ResearchIndicator[] = [];
  for (const item of raw.slice(0, MAX_LIST)) {
    if (!isObj(item)) continue;
    const type = str(item.type).toLowerCase();
    if (!(RESEARCH_INDICATORS as readonly string[]).includes(type)) {
      issues.push({ path: "indicators", message: `Unknown indicator type "${type || "?"}" was dropped.`, severity: "clamped" });
      continue;
    }
    const indicator: ResearchIndicator = { type: type as ResearchIndicatorType, role: boundedStr(item.role, 200) ?? "" };
    if (item.period !== undefined) {
      const period = intIn(item.period, 1, 400);
      if (period === null) {
        issues.push({ path: "indicators", message: `Indicator ${type} period out of range (1–400) was dropped.`, severity: "clamped" });
      } else {
        indicator.period = period;
      }
    }
    if (isObj(item.params)) {
      const params: Record<string, number> = {};
      for (const [k, val] of Object.entries(item.params)) {
        if (!/^[a-zA-Z0-9_]{1,24}$/.test(k)) continue;
        const n = numIn(val, -1e6, 1e6);
        if (n !== null) params[k] = n;
      }
      if (Object.keys(params).length) indicator.params = params;
    }
    out.push(indicator);
  }
  return out;
}

/**
 * Repair a model-proposed strategy configuration into a valid
 * `ChandelierDonchianConfig`. Returns null when the proposal cannot be
 * repaired — the report stays useful, but nothing executable is invented.
 */
export function repairStrategyConfig(raw: unknown, issues: ValidationIssue[]): ChandelierDonchianConfig | null {
  if (!isObj(raw)) return null;
  // A config object that names none of the strategy's real parts is
  // not a strategy proposal at all — silently substituting the
  // default config would present an untested default as the model's
  // recommendation. Degrade to research-only instead.
  const RECOGNIZED = ["chandelier", "donchian", "timeStop", "risk", "heikinAshi"];
  if (!RECOGNIZED.some((k) => k in raw)) {
    issues.push({
      path: "strategyConfig",
      message: "The proposed strategy configuration was not recognizable, so no executable config was derived; the report is research-only.",
      severity: "clamped",
    });
    return null;
  }
  const warnings: string[] = [];
  const clampInt = (v: unknown, min: number, max: number, fallback: number, label: string): number => {
    const n = intIn(v, min, max);
    if (n === null) { warnings.push(`${label} was out of range and reset to ${fallback}.`); return fallback; }
    if (v !== n) warnings.push(`${label} clamped to ${n}.`);
    return n;
  };
  const clampNum = (v: unknown, min: number, max: number, fallback: number, label: string): number => {
    const n = numIn(v, min, max);
    if (n === null) { warnings.push(`${label} was out of range and reset to ${fallback}.`); return fallback; }
    return n;
  };

  const ch = isObj(raw.chandelier) ? raw.chandelier : {};
  const dc = isObj(raw.donchian) ? raw.donchian : {};
  const ts = isObj(raw.timeStop) ? raw.timeStop : {};
  const rk = isObj(raw.risk) ? raw.risk : {};

  // Donchian periods: dedupe, sort, bound the count.
  let periods: number[] = [];
  if (Array.isArray(dc.periods)) {
    const seen = new Set<number>();
    for (const p of dc.periods) {
      const n = intIn(p, 1, 400);
      if (n !== null && !seen.has(n)) { seen.add(n); periods.push(n); }
    }
    periods = periods.sort((a, b) => a - b);
  }
  if (!periods.length) {
    periods = [20, 50, 100, 200];
    warnings.push("Donchian periods were missing or invalid; defaulted to 20/50/100/200.");
  }
  if (periods.length > 8) {
    periods = periods.slice(0, 8);
    warnings.push("Donchian periods truncated to 8 entries.");
  }

  const config: ChandelierDonchianConfig = {
    chandelier: {
      atrLength: clampInt(ch.atrLength, 1, 400, 1, "Chandelier ATR length"),
      multiplier: clampNum(ch.multiplier, 0.1, 10, 2, "Chandelier multiplier"),
    },
    donchian: { periods },
    heikinAshi: raw.heikinAshi === true,
    timeStop: {
      enabled: ts.enabled === true,
      bars: clampInt(ts.bars, 1, 10000, 48, "Time-stop bars"),
    },
    risk: {
      leverage: clampNum(rk.leverage, 1, 50, 10, "Leverage"),
      riskPct: clampNum(rk.riskPct, 0.01, 100, 1, "Risk %"),
      lotSize: rk.lotSize === null || rk.lotSize === undefined ? null : clampNum(rk.lotSize, 1e-8, 1e12, null as unknown as number, "Lot size"),
      maxPositions: clampInt(rk.maxPositions, 1, 50, 1, "Max positions"),
      mode: rk.mode === "manual" ? "manual" : "auto",
    },
  };
  // A manual lot size must be a positive finite number, or it is dropped.
  if (config.risk.mode === "manual" && (config.risk.lotSize === null || !Number.isFinite(config.risk.lotSize) || config.risk.lotSize <= 0)) {
    config.risk.mode = "auto";
    config.risk.lotSize = null;
    warnings.push("Manual lot size was invalid; position sizing reverted to auto (percent-of-equity risk).");
  }
  for (const w of warnings) issues.push({ path: "strategyConfig", message: w, severity: "clamped" });
  return config;
}

/**
 * Validate a raw model answer into a `ResearchReport`. The report is
 * accepted only when its mandatory narrative fields are present; a bad
 * strategy config degrades the report to research-only rather than
 * discarding the operator's research.
 */
export function validateResearchReport(raw: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isObj(raw)) {
    return { ok: false, report: null, issues: [{ path: "root", message: "Model response was not a JSON object.", severity: "rejected" }] };
  }

  const summary = boundedStr(raw.summary, 600);
  const hypothesis = boundedStr(raw.hypothesis, 800);
  const marketAssumptions = boundedStr(raw.marketAssumptions, 600);
  const stopLossLogic = boundedStr(raw.stopLossLogic, 400);
  const takeProfitLogic = boundedStr(raw.takeProfitLogic, 400);
  const positionSizing = boundedStr(raw.positionSizing, 400);
  const recommendedPeriodRationale = boundedStr(raw.recommendedPeriodRationale, 300);

  const missing = [
    ["summary", summary], ["hypothesis", hypothesis], ["marketAssumptions", marketAssumptions],
    ["stopLossLogic", stopLossLogic], ["takeProfitLogic", takeProfitLogic],
    ["positionSizing", positionSizing], ["recommendedPeriodRationale", recommendedPeriodRationale],
  ].filter(([, v]) => v === null).map(([k]) => k);
  if (missing.length) {
    return {
      ok: false, report: null,
      issues: [{ path: "root", message: `Model answer was incomplete — missing: ${missing.join(", ")}.`, severity: "rejected" }],
    };
  }

  const entryRules = strList(raw.entryRules);
  const exitRules = strList(raw.exitRules);
  const riskFactors = strList(raw.riskFactors);
  const overfittingConcerns = strList(raw.overfittingConcerns);
  const validationSteps = strList(raw.validationSteps);
  if (!entryRules.length || !exitRules.length) {
    return {
      ok: false, report: null,
      issues: [{ path: "root", message: "Model answer did not include usable entry and exit rules.", severity: "rejected" }],
    };
  }

  const recommendedBars = intIn(raw.recommendedBars, 50, 500) ?? 300;
  if (raw.recommendedBars !== undefined && recommendedBars !== Number(raw.recommendedBars)) {
    issues.push({ path: "recommendedBars", message: `Recommended backtest length clamped to ${recommendedBars} candles (allowed 50–500).`, severity: "clamped" });
  }

  const indicators = validateIndicators(raw.indicators, issues);
  const strategyConfig = repairStrategyConfig(raw.strategyConfig, issues);
  const warnings = strList(raw.warnings).concat(
    issues.filter((i) => i.severity === "clamped").map((i) => i.message)
  );

  const report: ResearchReport = {
    summary: summary!,
    hypothesis: hypothesis!,
    marketAssumptions: marketAssumptions!,
    entryRules, exitRules, indicators,
    stopLossLogic: stopLossLogic!, takeProfitLogic: takeProfitLogic!,
    positionSizing: positionSizing!,
    recommendedBars, recommendedPeriodRationale: recommendedPeriodRationale!,
    riskFactors, overfittingConcerns, validationSteps,
    strategyConfig,
    compatibility: strategyConfig ? "executable" : "research-only",
    warnings,
  };
  return { ok: true, report, issues };
}

/* ---------------- request-side validation ---------------- */

export function isResearchStrategyType(v: unknown): v is ResearchStrategyType {
  return typeof v === "string" && (RESEARCH_STRATEGY_TYPES as readonly string[]).includes(v);
}

export function isSupportedResearchSymbol(symbol: string, supported: string[]): boolean {
  const canonical = symbol.trim().toUpperCase();
  return supported.includes(canonical);
}

export function isSupportedTimeframe(v: unknown): v is Timeframe {
  return typeof v === "string" && (TIMEFRAMES as readonly string[]).includes(v);
}

/** Bounded, plain-English objective. Returns null when unusable. */
export function cleanObjective(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const clean = v.replace(/\s+/g, " ").trim();
  // Reject obvious prompt-injection payloads: the objective is research
  // input, never instructions to the agent runtime.
  if (/```|<\s*script|system\s*:|ignore (all |previous )?instructions/i.test(clean)) return null;
  return clean.length >= 10 && clean.length <= 2000 ? clean : null;
}
