/**
 * Backtest job workflow.
 *
 * Vercel serverless functions are bounded in time and memory, and a
 * request cannot assume anything lives after it returns. This module
 * therefore never keeps work in memory:
 *
 *   - every backtest is a persisted job row (Neon Postgres or the
 *     file mirror) with a deterministic idempotency key, so a retried
 *     or duplicated request returns the SAME job instead of running
 *     twice;
 *   - the workload is split into bounded segments — one for a plain
 *     backtest, one per walk-forward fold otherwise;
 *   - a segment is a single synchronous engine run over a candle
 *     window that is hard-capped, so it always finishes well inside
 *     one function invocation;
 *   - progress (segmentsDone) is persisted after every segment, so a
 *     walk-forward run can be resumed by the next invocation (the
 *     frontend polls and steps it, or a secured cron could).
 *
 * There is deliberately NO in-memory queue and NO assumption of a
 * long-lived process.
 */
import { getCandles, knownSymbols } from "../market/service";
import { TF_MINUTES, type Candle, type Timeframe } from "../types";
import { getRepo } from "../repo";
import { logAudit } from "../settings";
import {
  aggregateWalkForward,
  runBacktest,
  sanitizeCandles,
} from "../strategy/v2/backtest";
import {
  DEFAULT_CHANDELIER_DONCHIAN_CONFIG,
  validateStrategyConfig,
  type ChandelierDonchianConfig,
  type BacktestResult,
} from "../strategy/v2/types";
import { FILL_MODEL, type BacktestJob, type BacktestJobInsert } from "./types";

/** Hard ceiling on candles per run — matches the candle API cap. */
export const MAX_CANDLES = 500;
export const MIN_CANDLES = 50;
/** Fee/slippage sanity ceilings (a 5% fee is a typo, not a strategy). */
export const MAX_FEE_RATE = 0.05;
export const MAX_SLIPPAGE = 0.05;

export interface BacktestParams {
  symbol: string;
  timeframe: string;
  config: ChandelierDonchianConfig;
  capital: number;
  feeRate: number;
  slippage: number;
  candleLimit: number;
  walkForward: boolean;
  /** Walk-forward only; ignored (and stored as null) on plain runs. */
  trainWindow?: number;
  testWindow?: number;
  researchRunId?: string | null;
  workspace?: string;
  /** Caller-supplied dedup key; derived from params when absent. */
  idempotencyKey?: string;
}

export type BacktestOutcome =
  | { ok: true; job: BacktestJob; deduplicated: boolean }
  | { ok: false; error: string; job: BacktestJob | null };

/** FNV-1a — enough for a deterministic, collision-resistant-enough key. */
function hashKey(canonical: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `bt_${h.toString(36)}_${canonical.length.toString(36)}`;
}

/** Deterministic key from every parameter that changes the result. */
export function idempotencyKeyOf(p: BacktestParams): string {
  const canonical = JSON.stringify({
    symbol: p.symbol.trim().toUpperCase(),
    timeframe: p.timeframe,
    config: p.config,
    capital: p.capital,
    feeRate: p.feeRate,
    slippage: p.slippage,
    candleLimit: p.candleLimit,
    walkForward: p.walkForward,
    trainWindow: p.walkForward ? (p.trainWindow ?? 300) : null,
    testWindow: p.walkForward ? (p.testWindow ?? 100) : null,
  });
  return hashKey(canonical);
}

/** Validate every inbound parameter. Throws with a plain-English reason. */
export function validateBacktestParams(p: BacktestParams): void {
  const symbol = p.symbol.trim().toUpperCase();
  if (!knownSymbols().includes(symbol)) {
    throw new Error(`Unsupported symbol "${symbol}".`);
  }
  if (!TF_MINUTES[p.timeframe as Timeframe]) {
    throw new Error(`Unsupported timeframe "${p.timeframe}".`);
  }
  try {
    validateStrategyConfig(p.config);
  } catch {
    throw new Error("The strategy configuration is invalid (indicator periods or risk limits out of range).");
  }
  if (!Number.isFinite(p.capital) || p.capital <= 0 || p.capital > 1e9) {
    throw new Error("Initial capital must be a positive number below 1e9.");
  }
  if (![p.feeRate, p.slippage].every((v) => Number.isFinite(v) && v >= 0 && v <= MAX_FEE_RATE)) {
    throw new Error(`Fee rate and slippage must be between 0 and ${MAX_FEE_RATE}.`);
  }
  const limit = Math.round(p.candleLimit);
  if (!Number.isInteger(limit) || limit < MIN_CANDLES || limit > MAX_CANDLES) {
    throw new Error(`Candle count must be an integer between ${MIN_CANDLES} and ${MAX_CANDLES}.`);
  }
  if (p.walkForward) {
    const train = p.trainWindow ?? 300;
    const test = p.testWindow ?? 100;
    if (![train, test].every((v) => Number.isInteger(v) && v > 0)) {
      throw new Error("Walk-forward windows must be positive integers.");
    }
    if (train + test > limit) {
      throw new Error("Train + test windows exceed the candle count.");
    }
    if (test < 20) {
      throw new Error("Test window must be at least 20 candles to be meaningful.");
    }
  }
}

/** How many walk-forward folds fit in the loaded candles. */
export function foldPlan(candleCount: number, trainWindow: number, testWindow: number): { start: number; end: number }[] {
  const folds: { start: number; end: number }[] = [];
  for (let start = 0; start + trainWindow + testWindow <= candleCount; start += testWindow) {
    folds.push({ start, end: start + trainWindow + testWindow });
  }
  return folds;
}

/** Run one segment (a plain run or a single walk-forward fold). */
function runSegment(
  candles: Candle[],
  config: ChandelierDonchianConfig,
  capital: number,
  feeRate: number,
  slippage: number,
  tradeStartIndex: number,
  warnings: string[]
): BacktestResult {
  return runBacktest(
    candles,
    config,
    { initialCapital: capital, leverage: config.risk.leverage, riskPct: config.risk.riskPct, feeRate, slippage },
    tradeStartIndex,
    warnings
  );
}

/**
 * Create (or deduplicate) a backtest job and run its first segment.
 * A plain backtest completes inside this call; a walk-forward run is
 * left `running` for the caller to step through.
 * `deps.fetchCandles` exists so tests never touch the network.
 */
export async function createBacktestJob(
  params: BacktestParams,
  deps?: { fetchCandles?: typeof getCandles }
): Promise<BacktestOutcome> {
  const fetchCandles = deps?.fetchCandles ?? getCandles;
  validateBacktestParams(params);
  const symbol = params.symbol.trim().toUpperCase();
  const timeframe = params.timeframe as Timeframe;
  // Scope the dedup key to the workspace so an identical paper
  // and live job never collide (the workspace is server-derived
  // and validated, never client-controlled).
  const rawKey = params.idempotencyKey ?? idempotencyKeyOf(params);
  const key = `${params.workspace ?? "paper"}:${rawKey}`;
  const repo = await getRepo();

  // Duplicate/retry safety: the same parameters return the same job.
  const existing = await repo.findBacktestJobByKey(key);
  if (existing) {
    return { ok: true, job: existing, deduplicated: true };
  }

  const now = new Date().toISOString();
  const job: BacktestJobInsert = {
    id: `bt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    idempotencyKey: key,
    workspace: params.workspace ?? "paper",
    symbol,
    timeframe,
    config: params.config,
    capital: params.capital,
    feeRate: params.feeRate,
    slippage: params.slippage,
    candleLimit: Math.round(params.candleLimit),
    walkForward: params.walkForward,
    trainWindow: params.walkForward ? (params.trainWindow ?? 300) : null,
    testWindow: params.walkForward ? (params.testWindow ?? 100) : null,
    status: "queued",
    segmentsTotal: 1,
    segmentsDone: 0,
    result: null,
    segmentResults: null,
    dataWarnings: [],
    fillModel: FILL_MODEL,
    researchRunId: params.researchRunId ?? null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  // ---- load and clean the real candle data ----
  let candles: Candle[];
  let source: "live" | "demo";
  try {
    const res = await fetchCandles(symbol, timeframe, job.candleLimit);
    candles = res.candles;
    source = res.source;
  } catch (e) {
    const error = e instanceof Error ? e.message : "Market data unavailable";
    const failed = await repo.insertBacktestJob({ ...job, status: "failed", error });
    return { ok: false, error, job: failed };
  }

  const closed = candles.filter((c) => (c.time + TF_MINUTES[timeframe] * 60) * 1000 <= Date.now());
  const { candles: clean, warnings } = sanitizeCandles(closed);
  if (source === "demo") warnings.push("Demo simulator candles — not real market history.");
  if (clean.length < MIN_CANDLES) {
    const error = `Insufficient candle history (${clean.length} usable, ${MIN_CANDLES} minimum).`;
    const failed = await repo.insertBacktestJob({ ...job, status: "failed", error, dataWarnings: warnings });
    return { ok: false, error, job: failed };
  }
  if (clean.length < job.candleLimit) {
    warnings.push(`Only ${clean.length} of the requested ${job.candleLimit} candles were available; the run covers what exists.`);
  }

  const usedCandles = clean.slice(-job.candleLimit);

  // Effective walk-forward windows (defaults when the caller omitted them).
  const trainWindow = params.walkForward ? (params.trainWindow ?? 300) : 0;
  const testWindow = params.walkForward ? (params.testWindow ?? 100) : 0;

  // ---- build the segment plan ----
  if (params.walkForward) {
    const folds = foldPlan(usedCandles.length, trainWindow, testWindow);
    if (!folds.length) {
      const error = "Not enough candles for even one walk-forward fold with these windows.";
      const failed = await repo.insertBacktestJob({ ...job, status: "failed", error, dataWarnings: warnings });
      return { ok: false, error, job: failed };
    }
    job.segmentsTotal = folds.length;
  }

  const created = await repo.insertBacktestJob({ ...job, status: "running", dataWarnings: warnings, startedAt: now });

  try {
    if (!params.walkForward) {
      const result = runSegment(usedCandles, params.config, params.capital, params.feeRate, params.slippage, 0, warnings);
      const done = await repo.updateBacktestJob(created.id, {
        status: "completed",
        segmentsDone: 1,
        result,
        segmentResults: [result],
        completedAt: new Date().toISOString(),
      });
      await logAudit("backtest_completed", { jobId: created.id, symbol, timeframe, trades: result.totalTrades });
      return { ok: true, job: done ?? created, deduplicated: false };
    }

    // Walk-forward: run the first fold now; the rest are stepped.
    const folds = foldPlan(usedCandles.length, trainWindow, testWindow);
    const first = folds[0];
    const foldCandles = usedCandles.slice(first.start, first.end);
    const result = runSegment(foldCandles, params.config, params.capital, params.feeRate, params.slippage, trainWindow, warnings);
    const stepped = await repo.updateBacktestJob(created.id, {
      segmentsDone: 1,
      segmentResults: [result],
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, job: stepped ?? created, deduplicated: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Backtest failed";
    const failed = await repo.updateBacktestJob(created.id, { status: "failed", error });
    return { ok: false, error, job: failed ?? created };
  }
}

/**
 * Advance a walk-forward job by ONE fold. Idempotent per segment:
 * a fold is only ever counted once, and a retried step re-runs the
 * same deterministic fold rather than skipping ahead.
 */
export async function stepBacktestJob(jobId: string, deps?: { fetchCandles?: typeof getCandles }): Promise<BacktestOutcome> {
  const fetchCandles = deps?.fetchCandles ?? getCandles;
  const repo = await getRepo();
  const job = await repo.getBacktestJob(jobId);
  if (!job) return { ok: false, error: "Backtest job not found.", job: null };
  if (job.status === "completed") return { ok: true, job, deduplicated: true };
  if (job.status === "failed") return { ok: false, error: job.error ?? "Job previously failed.", job };
  if (!job.walkForward) {
    // A single-segment job has nothing to step; it either completed or
    // failed during creation.
    return { ok: false, error: "This backtest has no pending segments.", job };
  }

  const segmentsDone = job.segmentResults?.length ?? 0;
  if (segmentsDone >= job.segmentsTotal) {
    const aggregated = aggregateWalkForward(job.segmentResults ?? []);
    const done = await repo.updateBacktestJob(job.id, {
      status: "completed",
      segmentsDone: job.segmentsTotal,
      result: aggregated,
      completedAt: new Date().toISOString(),
    });
    await logAudit("backtest_completed", { jobId: job.id, symbol: job.symbol, folds: job.segmentsTotal });
    return { ok: true, job: done ?? job, deduplicated: true };
  }

  // Re-load the candles for the remaining folds (bounded, same cap).
  let candles: Candle[];
  try {
    const res = await fetchCandles(job.symbol, job.timeframe as Timeframe, job.candleLimit);
    const closed = res.candles.filter((c) => (c.time + TF_MINUTES[job.timeframe as Timeframe] * 60) * 1000 <= Date.now());
    const { candles: clean } = sanitizeCandles(closed);
    candles = clean.slice(-job.candleLimit);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Market data unavailable during resume";
    const failed = await repo.updateBacktestJob(job.id, { status: "failed", error });
    return { ok: false, error, job: failed ?? job };
  }

  const train = job.trainWindow ?? 300;
  const test = job.testWindow ?? 100;
  const folds = foldPlan(candles.length, train, test);
  const fold = folds[segmentsDone];
  if (!fold) {
    const failed = await repo.updateBacktestJob(job.id, {
      status: "failed",
      error: "Walk-forward plan no longer matches the available candles; restart the backtest.",
    });
    return { ok: false, error: "Walk-forward plan no longer matches the available candles.", job: failed ?? job };
  }

  try {
    const result = runSegment(
      candles.slice(fold.start, fold.end),
      job.config,
      job.capital,
      job.feeRate,
      job.slippage,
      train,
      job.dataWarnings
    );
    const nextResults = [...(job.segmentResults ?? []), result];
    const isLast = segmentsDone + 1 >= job.segmentsTotal;
    const patch: Partial<BacktestJob> = {
      segmentsDone: segmentsDone + 1,
      segmentResults: nextResults,
      updatedAt: new Date().toISOString(),
    };
    if (isLast) {
      patch.status = "completed";
      patch.result = aggregateWalkForward(nextResults);
      patch.completedAt = new Date().toISOString();
    }
    const updated = await repo.updateBacktestJob(job.id, patch);
    if (isLast) {
      await logAudit("backtest_completed", { jobId: job.id, symbol: job.symbol, folds: job.segmentsTotal });
    }
    return { ok: true, job: updated ?? job, deduplicated: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Backtest segment failed";
    const failed = await repo.updateBacktestJob(job.id, { status: "failed", error });
    return { ok: false, error, job: failed ?? job };
  }
}

export async function listBacktestJobs(opts?: { limit?: number; symbol?: string }): Promise<BacktestJob[]> {
  return (await getRepo()).listBacktestJobs(opts);
}

export async function getBacktestJob(id: string): Promise<BacktestJob | null> {
  return (await getRepo()).getBacktestJob(id);
}

/** Default config reused when a caller does not supply one. */
export function defaultBacktestConfig(): ChandelierDonchianConfig {
  return DEFAULT_CHANDELIER_DONCHIAN_CONFIG;
}
