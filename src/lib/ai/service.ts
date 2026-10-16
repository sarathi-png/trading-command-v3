/**
 * AI prediction service — the orchestrator the API route talks to.
 *
 * One entry point, one behaviour contract:
 *   - it always answers, even with no keys at all (rule-engine fallback)
 *   - it never spends free-tier quota twice on the same 5-minute bar
 *   - it never returns a prediction it could not validate
 *   - it records every answer, so the outcome scoreboard is real
 *
 * The provider choice is explicit in the response (`provider`, `degraded`,
 * `notice`) so the UI can always show where an answer came from.
 */
import { recallMemory } from "./memory";
import { getCandles } from "../market/service";
import { getSettings } from "../settings";
import { TF_MINUTES, type Candle, type Timeframe } from "../types";
import { buildAiContext } from "./context";
import { configuredProviders, resolveKey } from "./keys";
import { callFreeProvider } from "./autoProvider";
import { degradationNotice, validatePrediction } from "./prompt";
import { technicalConflicts, ruleEvidence, ruleVerdict } from "./rules";
import { budgetState, findCached, listPredictions, savePrediction, updatePredictions } from "./store";
import { predictOutcome, scorecard, type AiScorecard } from "./outcomes";
import {
  AI_DEFAULT_HORIZON_BARS,
  AI_PROVIDER_CATALOG,
  RULES_PROVIDER_LABEL,
  type AiChartType,
  type AiContext,
  type AiPrediction,
  type AiProviderId,
} from "./types";

export interface PredictRequest {
  symbol: string;
  timeframe: string;
  chartType: AiChartType;
  /** "auto" prefers a configured provider, then the rule engine. */
  provider: AiProviderId | "auto";
  /** Skip the decision-bar cache and re-ask. Still honours the free-tier budget. */
  force?: boolean;
}

export interface PredictResult {
  prediction: AiPrediction | null;
  /** True when the answer came from the decision-bar cache. */
  cached: boolean;
  /** Non-fatal note: a degraded provider, a rejected model answer, etc. */
  warning: string | null;
  /** Evidence lines from the indicator snapshot. */
  evidence: string[];
  error?: string;
}

function newId(): string {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Closed candles only: the decision bar must be a finished bar. */
function closedCandles(candles: { time: number }[], timeframe: Timeframe, now: number): { time: number }[] {
  const minutes = TF_MINUTES[timeframe] ?? 5;
  return candles.filter((c) => (c.time + minutes * 60) * 1000 <= now);
}

/** Pick the provider to try first. Returns null when the rule engine must answer. */
function chooseProvider(requested: AiProviderId | "auto"): Exclude<AiProviderId, "rules"> | null {
  if (requested === "rules") return null;
  if (requested !== "auto") return requested;
  const available = configuredProviders();
  if (!available.length) return null;
  // Prefer whichever provider still has room in today's free-tier budget.
  const withRoom = available.find((id) => !budgetState(id).blockedReason);
  return withRoom ?? available[0];
}

export async function predict(request: PredictRequest): Promise<PredictResult> {
  const settings = await getSettings();
  const aiSettings = settings.aiPrediction;
  const timeframe = (Object.hasOwn(TF_MINUTES, request.timeframe) ? request.timeframe : "5m") as Timeframe;
  const now = Date.now();

  let candles: Awaited<ReturnType<typeof getCandles>>;
  try {
    candles = await getCandles(request.symbol, timeframe, 500);
  } catch (e) {
    return { prediction: null, cached: false, warning: null, evidence: [], error: e instanceof Error ? e.message : "Market data unavailable" };
  }

  const usable = closedCandles(candles.candles, timeframe, now) as typeof candles.candles;
  const minimum = 60;
  if (usable.length < minimum) {
    return {
      prediction: null, cached: false, warning: null, evidence: [],
      error: `Not enough closed candles for the indicators (${usable.length} available, ${minimum} needed).`,
    };
  }

  const config = settings.chandelierDonchian;
  const context: AiContext = buildAiContext({
    symbol: request.symbol,
    timeframe,
    chartType: request.chartType,
    candles: usable,
    atrLength: config?.chandelier?.atrLength ?? 1,
    multiplier: config?.chandelier?.multiplier ?? 2.0,
    donchianPeriods: config?.donchian?.periods ?? [20, 50, 100, 200],
  });

  context.dataSource = candles.source;
  await resolveOutcomes();
  context.memory = recallMemory(context, listPredictions());

  const requested = aiSettings?.enabled === false ? "rules" : request.provider;
  const target = chooseProvider(requested);
  const providerId: AiProviderId = target ?? "rules";

  // Cache key: same instrument + chart type + decision bar + provider.
  if (!request.force) {
    const cached = findCached({
      symbol: request.symbol,
      chartType: request.chartType,
      barTime: context.lastBarTime,
      provider: providerId,
      timeframe,
      dataSource: context.dataSource,
      technicalVersion: context.technical?.version,
      indicatorSignature: context.indicatorSignature,
    });
    if (cached && cached.context.dataSource === context.dataSource && cached.context.technical?.version === context.technical?.version) {
      return { prediction: cached, cached: true, warning: null, evidence: ruleEvidence(context) };
    }
  }

  let warning: string | null = null;

  if (!target) {
    // No key configured (or the predictor is pinned to the rule engine). Say so
    // instead of leaving the user wondering why a model was never used.
    const notice = requested === "rules"
      ? "The built-in rule engine is selected as the engine, so no external model is called."
      : "No OpenRouter or NVIDIA API key is configured, so the built-in Chandelier + Donchian rule engine answered. Add a free-tier key in AI CONNECTION → AI SIGNAL PREDICTION to use a model.";
    const prediction = buildRulePrediction(context, notice);
    await persistPrediction(prediction);
    return { prediction, cached: false, warning: notice, evidence: ruleEvidence(context) };
  }

  const resolved = resolveKey(target);
  const providerLabel = AI_PROVIDER_CATALOG[target].label;

  if (!resolved.key) {
    const prediction = buildRulePrediction(context, degradationNotice("no API key is configured for it", providerLabel));
    await persistPrediction(prediction);
    return { prediction, cached: false, warning: prediction.notice, evidence: ruleEvidence(context) };
  }

  const budget = budgetState(target, now);
  if (budget.blockedReason) {
    const prediction = buildRulePrediction(context, degradationNotice(budget.blockedReason, providerLabel));
    await persistPrediction(prediction);
    return { prediction, cached: false, warning: prediction.notice, evidence: ruleEvidence(context) };
  }

  // Count the call before making it: a provider error still consumed quota.
  const call = await callFreeProvider(target, context, resolved.key);

  if (!call.ok) {
    const notice = degradationNotice(call.error, providerLabel);
    const prediction = buildRulePrediction(context, notice);
    prediction.provider = "rules";
    await persistPrediction(prediction);
    return { prediction, cached: false, warning: notice, evidence: ruleEvidence(context) };
  }

  const validated = validatePrediction(call.raw, context);
  if (!validated.ok) {
    const notice = degradationNotice(`its answer failed validation (${validated.error})`, providerLabel);
    const prediction = buildRulePrediction(context, notice);
    await persistPrediction(prediction);
    return { prediction, cached: false, warning: notice, evidence: ruleEvidence(context) };
  }

  const v = validated.value;
  const modelDecision = { direction: v.direction, rationale: v.rationale, confidence: v.confidence };
  const conflicts = technicalConflicts(context, v.direction);
  if (conflicts.length) {
    v.direction = "NEUTRAL";
    v.invalidation = null;
    v.confidence = 30;
    v.rationale = `Technical safety veto: ${conflicts.join("; ")}. No directional call.`;
    warning = "The model proposed a direction contradicted by the stored technical checks; the published call was reduced to NEUTRAL.";
  }
  const prediction: AiPrediction = {
    id: newId(),
    symbol: request.symbol,
    timeframe,
    chartType: request.chartType,
    provider: target,
    model: call.model,
    modelDecision,
    direction: v.direction,
    confidence: v.confidence,
    horizonBars: v.horizonBars ?? AI_DEFAULT_HORIZON_BARS,
    rationale: v.rationale,
    invalidation: v.invalidation,
    keyLevels: v.keyLevels,
    entryPrice: context.lastClose,
    createdAt: now,
    barTime: context.lastBarTime,
    context,
    degraded: false,
    notice: warning,
    outcome: null,
  };

  await persistPrediction(prediction);
  return { prediction, cached: false, warning, evidence: ruleEvidence(context) };
}

async function persistPrediction(prediction: AiPrediction): Promise<void> {
  prediction.memoryStored = true;
  if (!await savePrediction(prediction)) {
    prediction.memoryStored = false;
    prediction.notice = [prediction.notice, "Memory write failed; this call cannot be recalled after this response."].filter(Boolean).join(" ");
  }
}

/** Assemble a prediction from the rule engine (used for every fallback path). */
function buildRulePrediction(context: AiContext, notice: string | null): AiPrediction {
  const verdict = ruleVerdict(context);
  return {
    id: newId(),
    symbol: context.symbol,
    timeframe: context.timeframe,
    chartType: context.chartType,
    provider: "rules",
    model: "chandelier-donchian-rules-v1",
    direction: verdict.direction,
    confidence: verdict.confidence,
    horizonBars: AI_DEFAULT_HORIZON_BARS,
    rationale: verdict.rationale,
    invalidation: verdict.invalidation,
    keyLevels: verdict.keyLevels,
    entryPrice: context.lastClose,
    createdAt: Date.now(),
    barTime: context.lastBarTime,
    context,
    degraded: true,
    notice,
    outcome: null,
  };
}

/**
 * Re-score every stored prediction that is still pending, using freshly fetched
 * candles. Bounded work: one candle fetch per (symbol, timeframe) pair actually
 * present in the ledger, never per prediction.
 */
export async function resolveOutcomes(): Promise<AiPrediction[]> {
  const rows = listPredictions();
  const pending = rows.filter((p) => !p.outcome || p.outcome.resolution === "pending");
  if (!pending.length) return rows;

  const keys = [...new Set(pending.map((p) => `${p.symbol}|${p.timeframe}`))];
  const series = new Map<string, { candles: Candle[]; source: "demo" | "live" }>();
  for (const key of keys) {
    const [symbol, timeframe] = key.split("|");
    try {
      const res = await getCandles(symbol, timeframe as Timeframe, 500);
      series.set(key, { candles: closedCandles(res.candles, timeframe as Timeframe, Date.now()) as Candle[], source: res.source });
    } catch {
      // A missing series simply leaves those predictions pending.
    }
  }

  const updates: AiPrediction[] = [];
  for (const prediction of pending) {
    const data = series.get(`${prediction.symbol}|${prediction.timeframe}`);
    if (!data || !prediction.context.dataSource || prediction.context.dataSource !== data.source) continue;
    const outcome = predictOutcome(prediction, data.candles);
    if (outcome.resolution !== "pending") updates.push({ ...prediction, outcome });
  }
  if (updates.length) await updatePredictions(updates);
  return rows.map((p) => updates.find((u) => u.id === p.id) ?? p);
}

export interface AiPerformance {
  scorecard: AiScorecard;
  /** Status of every provider, including free-tier budget usage. */
  providers: Array<{
    id: AiProviderId;
    label: string;
    configured: boolean;
    keySource: "env" | "file" | null;
    keyHint: string | null;
    model: string;
    callsToday: number;
    dailyLimit: number;
    minIntervalSeconds: number;
    waitSeconds: number;
    lastCallAt: number | null;
    blockedReason: string | null;
  }>;
  /** Newest predictions, already scored where possible. */
  recent: AiPrediction[];
  enabled: boolean;
}

export async function aiPerformance(limit = 25): Promise<AiPerformance> {
  const settings = await getSettings();
  const rows = await resolveOutcomes();
  const providers: AiPerformance["providers"] = [
    {
      id: "rules",
      label: RULES_PROVIDER_LABEL,
      configured: true,
      keySource: null,
      keyHint: null,
      model: "chandelier-donchian-rules-v1",
      callsToday: 0,
      dailyLimit: Number.POSITIVE_INFINITY,
      minIntervalSeconds: 0,
      waitSeconds: 0,
      lastCallAt: null,
      blockedReason: null,
    },
    ...(["openrouter", "nvidia"] as const).map((id) => {
      const key = resolveKey(id);
      const budget = budgetState(id);
      return {
        id: id as AiProviderId,
        label: AI_PROVIDER_CATALOG[id].label,
        configured: Boolean(key.key),
        keySource: key.source,
        keyHint: key.hint,
        model: "Auto · verified free catalog",
        callsToday: budget.callsToday,
        dailyLimit: budget.dailyLimit,
        minIntervalSeconds: budget.minIntervalSeconds,
        waitSeconds: budget.waitSeconds,
        lastCallAt: budget.lastCallAt,
        blockedReason: budget.blockedReason,
      };
    }),
  ];

  return {
    scorecard: scorecard(rows),
    providers,
    recent: [...rows].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit),
    enabled: settings.aiPrediction?.enabled !== false,
  };
}
