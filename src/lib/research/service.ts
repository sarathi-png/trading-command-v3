/**
 * AI-assisted strategy research service.
 *
 * One entry point, one contract:
 *   - it only reasons over REAL market evidence (closed candles from
 *     the same market facade the charts use — demo or live, never
 *     fabricated)
 *   - the model's answer is untrusted input, validated against strict
 *     allowlists before it is stored or shown
 *   - a provider failure is a useful error, and the operator's input
 *     is preserved in the failed run so it can be revised
 *   - nothing here can place an order: the only executable output is
 *     a validated config consumed by the existing backtesting engine
 */
import { getCandles } from "../market/service";
import { knownSymbols } from "../market/service";
import { buildAiContext } from "../ai/context";
import { configuredProviders, resolveKey } from "../ai/keys";
import { callFreeProvider } from "../ai/autoProvider";
import { extractJson } from "../ai/prompt";
import { TF_MINUTES, type Candle, type Timeframe } from "../types";
import { getRepo } from "../repo";
import { logAudit } from "../settings";
import { cleanObjective, isResearchStrategyType, isSupportedResearchSymbol, isSupportedTimeframe, validateResearchReport } from "./validate";
import { researchSystemPrompt, researchUserPrompt } from "./prompt";
import { AI_PROVIDER_CATALOG, RULES_PROVIDER_LABEL, type AiProviderId } from "../ai/types";
import type { ResearchReport, ResearchRequest, ResearchRun, ResearchRunInsert } from "./types";

/** Provider timeout for research calls (ms). Research answers are longer. */
export const RESEARCH_TIMEOUT_MS = Number(process.env.AI_RESEARCH_TIMEOUT_MS ?? 50_000) || 50_000;
/** Minimum closed candles the evidence snapshot needs. */
export const RESEARCH_MIN_CANDLES = 60;
/** Ceiling on candles fetched for evidence (matches the candle API cap). */
export const RESEARCH_CANDLES = 500;

export interface ResearchFailure {
  ok: false;
  error: string;
  /** The run was still persisted (status="failed") so the input is preserved. */
  run: ResearchRun;
}
export interface ResearchSuccess {
  ok: true;
  run: ResearchRun;
  /** Validation/clamping notes surfaced alongside the report. */
  issues: { path: string; message: string; severity: string }[];
}
export type ResearchOutcome = ResearchSuccess | ResearchFailure;

function newId(): string {
  return `res_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Closed candles only — the forming bar is not evidence. */
function closedCandles(candles: Candle[], timeframe: Timeframe, now: number): Candle[] {
  const minutes = TF_MINUTES[timeframe] ?? 5;
  return candles.filter((c) => (c.time + minutes * 60) * 1000 <= now);
}

/** Which provider to ask. Null means "no usable key configured". */
function chooseProvider(requested: string): Exclude<AiProviderId, "rules"> | null {
  const available = configuredProviders();
  if (!available.length) return null;
  if (requested === "auto") return available[0] ?? null;
  return (available as string[]).includes(requested)
    ? (requested as Exclude<AiProviderId, "rules">)
    : available[0] ?? null;
}

/**
 * Run one research request end to end: fetch real evidence, ask the
 * configured provider, validate the answer, persist the run.
 * `deps.fetchImpl` exists so tests can run the whole path without
 * touching the network.
 */
export async function runResearch(
  request: ResearchRequest,
  deps?: { fetchImpl?: typeof fetch; fetchCandles?: typeof getCandles }
): Promise<ResearchOutcome> {
  const supported = knownSymbols();
  const symbol = request.symbol.trim().toUpperCase();
  const timeframe = request.timeframe;

  // ---- request-side validation (fail before spending any quota) ----
  if (!isSupportedResearchSymbol(symbol, supported)) {
    throw new Error(`Unsupported symbol "${symbol}". Supported: ${supported.join(", ")}.`);
  }
  if (!isSupportedTimeframe(timeframe)) {
    throw new Error(`Unsupported timeframe "${timeframe}".`);
  }
  if (!isResearchStrategyType(request.strategyType)) {
    throw new Error(`Unsupported strategy type "${request.strategyType}".`);
  }
  const objective = cleanObjective(request.objective);
  if (objective === null) {
    throw new Error("Objective must be 10–2000 characters of plain English (no code or embedded instructions).");
  }
  const constraints = request.constraints ? cleanObjective(request.constraints) ?? "" : "";

  const now = Date.now();
  const provider = chooseProvider(String(request.provider ?? "auto"));
  const resolved = provider ? resolveKey(provider) : null;

  // ---- the run row exists before any network call, so a failure is auditable ----
  const base: ResearchRunInsert = {
    id: newId(),
    workspace: "paper",
    symbol,
    timeframe: timeframe as Timeframe,
    strategyType: request.strategyType,
    objective,
    constraints,
    provider: provider ?? "none",
    model: resolved?.model ?? "none",
    status: "failed",
    report: null,
    marketEvidence: null,
    error: null,
    revisionOf: request.revisionOf ?? null,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };

  // ---- real market evidence, from the same facade as the charts ----
  const fetchCandles = deps?.fetchCandles ?? getCandles;
  let candles: Candle[];
  let source: "demo" | "live";
  try {
    const res = await fetchCandles(symbol, timeframe as Timeframe, RESEARCH_CANDLES);
    candles = closedCandles(res.candles, timeframe as Timeframe, now);
    source = res.source;
  } catch (e) {
    const error = e instanceof Error ? e.message : "Market data unavailable";
    const run = await persist({ ...base, error });
    return { ok: false, error, run };
  }
  if (candles.length < RESEARCH_MIN_CANDLES) {
    const error = `Not enough closed candles for research (${candles.length} available, ${RESEARCH_MIN_CANDLES} needed). Widen the data source or pick a higher timeframe.`;
    const run = await persist({ ...base, error });
    return { ok: false, error, run };
  }

  // No key configured: say so plainly. There is deliberately NO rule-engine
  // fallback here — a fabricated "research report" would be worse than none.
  if (!provider || !resolved?.key) {
    const error = `No AI provider key is configured, so no research could be run. Add a free-tier OpenRouter or NVIDIA key in AI CONNECTION. ${RULES_PROVIDER_LABEL} answers signal predictions, not open-ended research.`;
    const run = await persist({ ...base, error });
    return { ok: false, error, run };
  }

  // ---- evidence snapshot handed to the model ----
  const context = buildAiContext({
    symbol,
    timeframe: timeframe as Timeframe,
    chartType: "candles",
    candles,
  });
  const marketEvidence = {
    dataSource: source,
    closedBars: candles.length,
    indicatorSnapshot: {
      atr: context.atr,
      chandelier: context.chandelier,
      donchianAlignedPeriods: context.donchian.alignedPeriods,
      heikinAshi: context.heikinAshi,
      priceAction: context.priceAction,
    },
  };

  // ---- provider call with the research prompt ----
  const call = await callFreeProvider(
    provider,
    context,
    resolved.key,
    deps?.fetchImpl ?? fetch,
    { timeoutMs: RESEARCH_TIMEOUT_MS, prompt: { system: researchSystemPrompt(), user: researchUserPrompt({ request: { ...request, objective, constraints }, context }) } }
  );

  if (!call.ok) {
    const error = `Research provider failed: ${call.error}`;
    const run = await persist({ ...base, error });
    return { ok: false, error, run };
  }

  // ---- validate the untrusted answer ----
  let raw: unknown;
  try {
    raw = extractJson(typeof call.raw === "string" ? call.raw : JSON.stringify(call.raw));
  } catch {
    const error = "The model did not return usable JSON. Revise the objective and try again.";
    const run = await persist({ ...base, error });
    return { ok: false, error, run };
  }
  const validated = validateResearchReport(raw);
  if (!validated.ok || !validated.report) {
    const error = `The research answer failed validation: ${validated.issues.map((i) => i.message).join(" ")}`;
    const run = await persist({ ...base, error });
    return { ok: false, error, run };
  }

  const report: ResearchReport = validated.report;
  const run = await persist({
    ...base,
    status: "completed",
    report,
    marketEvidence,
    model: call.model,
    error: null,
  });
  await logAudit("research_completed", { runId: run.id, symbol, timeframe, strategyType: request.strategyType, executable: report.compatibility === "executable" });
  return { ok: true, run, issues: validated.issues };
}

/* ---------------- persistence ---------------- */

async function persist(insert: ResearchRunInsert): Promise<ResearchRun> {
  return (await getRepo()).insertResearchRun(insert);
}

export async function listResearchRuns(opts?: { symbol?: string; limit?: number }): Promise<ResearchRun[]> {
  return (await getRepo()).listResearchRuns(opts);
}

export async function getResearchRun(id: string): Promise<ResearchRun | null> {
  return (await getRepo()).getResearchRun(id);
}

/**
 * List the executable paper-trading handoff requires the run to be
 * completed AND to carry a validated config.
 */
export function canPromoteToPaper(run: ResearchRun): boolean {
  return run.status === "completed" && run.report?.strategyConfig !== null;
}

/** Provider label for UI display; never contains a key. */
export function providerLabel(id: string): string {
  return (AI_PROVIDER_CATALOG as Record<string, { label: string }>)[id]?.label ?? id;
}
