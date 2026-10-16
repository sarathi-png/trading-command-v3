/**
 * Prediction ledger and free-tier budget accounting.
 *
 * Two documents under `data/`:
 *   - `ai-predictions.json` — every call the system made, with the evidence it
 *     was based on and (once enough candles print) its outcome. This is what
 *     makes the feature accountable instead of decorative.
 *   - `ai-budget.json` — per-provider call counters for the current UTC day and
 *     the timestamp of the last call, so a free-tier key cannot be hammered by
 *     an impatient user or a polling loop.
 *
 * Both are plain documents read through `fileStore`, so they work on the file
 * backend and degrade to "no memory" (never an error) when the directory is
 * read-only.
 */
import { readDoc, writeDoc } from "../fileStore";
import { AI_FREE_TIER_LIMITS, type AiPrediction, type AiProviderId } from "./types";

const PREDICTIONS_DOC = "ai-predictions.json";
const BUDGET_DOC = "ai-budget.json";

/** Bounded recent history, not a permanent archive (500 calls may be one busy day). */
const MAX_PREDICTIONS = 500;

interface BudgetDoc {
  /** UTC day key (YYYY-MM-DD) → provider → call count. */
  days: Record<string, Record<string, number>>;
  lastCallAt: Record<string, number>;
}

export function utcDayKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function readBudget(): BudgetDoc {
  const doc = readDoc<BudgetDoc>(BUDGET_DOC, { days: {}, lastCallAt: {} });
  return {
    days: doc?.days && typeof doc.days === "object" ? doc.days : {},
    lastCallAt: doc?.lastCallAt && typeof doc.lastCallAt === "object" ? doc.lastCallAt : {},
  };
}

export interface BudgetState {
  callsToday: number;
  dailyLimit: number;
  minIntervalSeconds: number;
  /** Seconds still to wait before the next call is allowed; 0 when free. */
  waitSeconds: number;
  lastCallAt: number | null;
  /** Why the call is blocked, when it is. */
  blockedReason: string | null;
}

/** Current budget state for a provider. Pure read. */
export function budgetState(provider: Exclude<AiProviderId, "rules">, now: number = Date.now()): BudgetState {
  const limits = AI_FREE_TIER_LIMITS[provider];
  const doc = readBudget();
  const callsToday = doc.days[utcDayKey(now)]?.[provider] ?? 0;
  const lastCallAt = doc.lastCallAt[provider] ?? null;
  const elapsed = lastCallAt === null ? Number.POSITIVE_INFINITY : (now - lastCallAt) / 1000;
  const waitSeconds = Math.max(0, Math.ceil(limits.minIntervalSeconds - elapsed));

  let blockedReason: string | null = null;
  if (callsToday >= limits.dailyLimit) {
    blockedReason = `Daily free-tier budget reached (${callsToday}/${limits.dailyLimit} calls today).`;
  } else if (waitSeconds > 0) {
    blockedReason = `Free-tier spacing: next call allowed in ${waitSeconds}s.`;
  }

  return {
    callsToday,
    dailyLimit: limits.dailyLimit,
    minIntervalSeconds: limits.minIntervalSeconds,
    waitSeconds,
    lastCallAt,
    blockedReason,
  };
}

/** Record that a call was made (whether or not the provider answered). */
export async function recordCall(provider: Exclude<AiProviderId, "rules">, now: number = Date.now()): Promise<void> {
  const doc = readBudget();
  const day = utcDayKey(now);
  const days = { ...doc.days, [day]: { ...(doc.days[day] ?? {}) } };
  days[day][provider] = (days[day][provider] ?? 0) + 1;
  // Keep a week of counters; anything older has no bearing on today's quota.
  const keep = Object.keys(days).sort().slice(-7);
  const trimmed: Record<string, Record<string, number>> = {};
  for (const k of keep) trimmed[k] = days[k];
  await writeDoc(BUDGET_DOC, { days: trimmed, lastCallAt: { ...doc.lastCallAt, [provider]: now } });
}

export function listPredictions(): AiPrediction[] {
  const rows = readDoc<AiPrediction[]>(PREDICTIONS_DOC, []);
  return Array.isArray(rows) ? rows : [];
}

/** Newest first, optionally filtered. */
export function recentPredictions(opts: { symbol?: string; chartType?: string; limit?: number } = {}): AiPrediction[] {
  let rows = listPredictions();
  if (opts.symbol) rows = rows.filter((r) => r.symbol === opts.symbol);
  if (opts.chartType) rows = rows.filter((r) => r.chartType === opts.chartType);
  rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

/**
 * Find a prediction made from the same decision bar, provider and chart type.
 * Reusing it is what keeps polling the UI from burning a free-tier quota: the
 * 5-minute bar is the natural cache key.
 */
export function findCached(opts: {
  symbol: string;
  chartType: string;
  barTime: number;
  provider: AiProviderId;
  timeframe: string;
  dataSource?: "demo" | "live";
  technicalVersion?: string;
  indicatorSignature?: string;
}): AiPrediction | null {
  const match = listPredictions().find(
    (p) =>
      p.symbol === opts.symbol &&
      p.chartType === opts.chartType &&
      p.timeframe === opts.timeframe &&
      p.barTime === opts.barTime &&
      p.provider === opts.provider &&
      (opts.dataSource === undefined || p.context.dataSource === opts.dataSource) &&
      (opts.technicalVersion === undefined || p.context.technical?.version === opts.technicalVersion) &&
      (opts.indicatorSignature === undefined || p.context.indicatorSignature === opts.indicatorSignature)
  );
  return match ?? null;
}

// Serialize whole read-modify-write operations, not just disk writes: both chart
// panes can publish at once. Single-process only; shared multi-instance storage
// still requires a transactional database repository.
let ledgerQueue: Promise<unknown> = Promise.resolve();
function mutateLedger(change: (rows: AiPrediction[]) => AiPrediction[]): Promise<boolean> {
  const next = ledgerQueue.then(() => writeDoc(PREDICTIONS_DOC, change(listPredictions())));
  ledgerQueue = next.catch(() => false);
  return next;
}
export async function savePrediction(prediction: AiPrediction): Promise<boolean> {
  return mutateLedger(rows => [...rows.filter(p => p.id !== prediction.id), prediction]
    .sort((a,b) => a.createdAt-b.createdAt).slice(-MAX_PREDICTIONS));
}

/** Replace stored rows by id — used by the outcome resolver. */
export async function updatePredictions(updates: AiPrediction[]): Promise<boolean> {
  if (!updates.length) return true;
  const byId = new Map(updates.map((u) => [u.id, u]));
  return mutateLedger(rows => rows.map(p => byId.get(p.id) ?? p));
}

/** Test/ops helper: wipes the ledger. */
export async function clearPredictions(): Promise<boolean> {
  return writeDoc(PREDICTIONS_DOC, []);
}
