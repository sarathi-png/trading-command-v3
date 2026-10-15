/** Automatic import ledger, never an execution service. Use one scheduled worker. */
import { createHash } from "node:crypto";
import { getRepo, type JournalInsert, type JournalRow, type PaperPositionRow } from "../repo";
import { getSettings } from "../settings";
import { exchangeAccountConfigured } from "../credentials";
import { exchangeClient } from "../exchange/service";
import { fills as readFills } from "../exchange/coindcx/account";
import { knownSymbols } from "../exchange/symbols";
import { listPredictions } from "../ai/store";
import { priorPredictionContext, type PredictionContext } from "./context";
import { matchJournalFills, stableUuid, type JournalFill } from "./fifo";
const DAY = 86_400_000, PAGE_SIZE = 100;
const STATE = "journal-sync-v1";
interface Archive {
  fills: JournalFill[];
  coveredThrough: number | null;
  historyFrom: number;
  cursor?: { from: number; to: number; page: number; occurrences: Record<string, number> };
  error: string | null;
  lastAttempt: number;
  journalFacts?: Record<string, string>;
}
export interface JournalSyncStatus {
  configured: boolean;
  updatedAt: number | null;
  nextPair: number;
  pairs: { symbol: string; margin: "USDT" | "INR"; fills: number; historyFrom: number | null; coveredThrough: number | null; pendingPage: number | null; error: string | null }[];
  note: string;
}
const pairs = () => knownSymbols().flatMap(symbol => (["USDT", "INR"] as const).map(margin => ({symbol, margin})));
const archiveKey = (symbol: string, margin: string) => `journal-fills-v1:${symbol}:${margin}`;
const midnight = (ms: number) => Math.floor(ms / DAY) * DAY;
function historyStart(now: number): number {
  const configured = Date.parse(process.env.COINDCX_JOURNAL_FROM ?? "");
  return midnight(Number.isFinite(configured) && configured > 0 && configured < now ? configured : now - 90 * DAY);
}
export async function journalSyncStatus(): Promise<JournalSyncStatus> {
  const repo = await getRepo();
  const state = await repo.getSetting(STATE) as { nextPair?: number; updatedAt?: number } | null;
  const entries = await Promise.all(pairs().map(async ({symbol, margin}) => {
    const archive = await repo.getSetting(archiveKey(symbol, margin)) as Archive | null;
    return { symbol, margin, fills: archive?.fills.length ?? 0, historyFrom: archive?.historyFrom ?? null, coveredThrough: archive?.coveredThrough ?? null,
      pendingPage: archive?.cursor?.page ?? null, error: archive?.error ?? null };
  }));
  return { configured: await exchangeAccountConfigured(), updatedAt: state?.updatedAt ?? null, nextPair: state?.nextPair ?? 0, pairs: entries,
    note: "Bounded rotating sync: 20 supported symbols × USDT/INR margin accounts, at most 4 pages per request. Initial lookback 90 days unless COINDCX_JOURNAL_FROM is set before first sync. Opening fills before that boundary are unknown. All retrieved fills are retained, including open activity. Closed rows are FIFO estimates, not venue-booked P&L; funding/liquidation are not included. Run one external scheduler for browser-closed collection. No credentials or network access = no live history." };
}
let inFlight: Promise<JournalSyncStatus> | null = null;
export async function syncCoinDcxJournal(): Promise<JournalSyncStatus> {
  if (!(await exchangeAccountConfigured())) return journalSyncStatus();
  if (inFlight) return inFlight;
  inFlight = syncNextPair().finally(() => { inFlight = null; });
  return inFlight;
}
async function syncNextPair(): Promise<JournalSyncStatus> {
  const repo = await getRepo(), settings = await getSettings();
  const state = await repo.getSetting(STATE) as { nextPair?: number } | null;
  const all = pairs(), index = (state?.nextPair ?? 0) % all.length;
  const {symbol, margin} = all[index], now = Date.now();
  const key = archiveKey(symbol, margin);
  const archive = await repo.getSetting(key) as Archive | null ?? { fills: [], coveredThrough: null, historyFrom: historyStart(now), error: null, lastAttempt: 0 };
  if (!archive.cursor) archive.cursor = { from: archive.coveredThrough ? midnight(archive.coveredThrough - DAY) : archive.historyFrom, to: now, page: 1, occurrences: {} };
  archive.lastAttempt = now;
  let complete = false;
  try {
    for (let count = 0; count < 4; count++) {
      const cursor = archive.cursor!;
      const rows = await readFills(exchangeClient({ timeoutMs: 5_000, maxReadRetries: 0 }), { symbol, marginCurrency: margin, fromMs: cursor.from, toMs: cursor.to, page: cursor.page, size: PAGE_SIZE });
      const byKey = new Map(archive.fills.map(fill => [fill.key, fill]));
      for (const row of rows) {
        if (![row.price, row.quantity, row.fee, row.ts].every(Number.isFinite) || row.price <= 0 || row.quantity <= 0 || row.ts <= 0) throw Error("Malformed fill; import paused rather than inventing timestamps or prices");
        const native = JSON.stringify([symbol, margin, row.id, row.ts, row.side, row.price, row.quantity, row.fee]);
        const fingerprint = createHash("sha256").update(native).digest("hex");
        const occurrence = cursor.occurrences[fingerprint] ?? 0;
        cursor.occurrences[fingerprint] = occurrence + 1;
        const fillKey = `${symbol}:${margin}:${row.fillId ? `venue:${row.fillId}` : `${fingerprint}:${occurrence}`}`;
        if (!byKey.has(fillKey)) byKey.set(fillKey, { key: fillKey, symbol, margin, orderId: row.id, side: row.side, price: row.price, quantity: row.quantity,
          nativeFee: row.fee, fee: margin === "INR" ? row.fee / settings.usdInrRate : row.fee, fxRate: margin === "INR" ? settings.usdInrRate : 1, ts: row.ts });
      }
      archive.fills = [...byKey.values()];
      archive.error = null;
      if (rows.length < PAGE_SIZE) {
        archive.coveredThrough = cursor.to; delete archive.cursor; complete = true;
      } else cursor.page += 1;
      await repo.saveSetting(key, archive);
      if (complete) break;
    }
    if (complete) {
      const matches = matchJournalFills(archive.fills);
      const changed = matches.filter(trade => archive.journalFacts?.[trade.id] !== JSON.stringify(trade));
      const values: JournalInsert[] = changed.map(trade => ({ ...trade, mode: "live", source: "coindcx", strategy: "coindcx-fifo", notes: "", emotion: "", tags: ["automatic", "fifo-estimate", `margin:${margin}`],
        reason: margin === "INR" ? "FIFO reconstructed; INR commissions converted once using the import-time manual FX rate. Not venue-booked P&L." : "FIFO reconstructed from USDT-margin fills. Not venue-booked P&L; funding/liquidations excluded." }));
      for (let offset = 0; offset < values.length; offset += 300) await repo.upsertImportedJournal(values.slice(offset, offset + 300));
      const predictions = listPredictions();
      for (const value of values) {
        const contextKey = `journal-context:${value.id}`;
        if (await repo.getSetting(contextKey) !== null) continue;
        await repo.saveSetting(contextKey, priorPredictionContext(predictions, symbol, value.direction, Date.parse(String(value.openedAt)), "live"));
      }
      archive.journalFacts = { ...archive.journalFacts };
      for (const trade of changed) archive.journalFacts[trade.id] = JSON.stringify(trade);
      await repo.saveSetting(key, archive);
    }
  } catch {
    // Do not surface arbitrary upstream text (may contain private response data).
    archive.error = "CoinDCX read or storage failed. Retained fills are preserved; closed rows may remain incomplete. Check credentials, connectivity and storage, then retry the next cycle.";
    await repo.saveSetting(key, archive);
  }
  await repo.saveSetting(STATE, { nextPair: (index + 1) % all.length, updatedAt: Date.now() });
  return journalSyncStatus();
}
export async function importedFills(): Promise<JournalFill[]> {
  const repo = await getRepo();
  const archives = await Promise.all(pairs().map(async p => await repo.getSetting(archiveKey(p.symbol,p.margin)) as Archive | null));
  return archives.flatMap(a => a?.fills ?? []).sort((a,b) => b.ts - a.ts);
}
/** Snapshot context at opening, while the bounded AI memory still contains it. */
export async function snapshotPaperContext(position: PaperPositionRow): Promise<void> {
  const repo = await getRepo(), settings = await getSettings();
  await repo.saveSetting(`paper-context:${position.id}`, { source: settings.dataSource, predictions: priorPredictionContext(listPredictions(), position.symbol, position.side, Date.parse(position.openedAt), settings.dataSource) });
  await repo.saveSetting(`paper-accounting-v2:${position.id}`, true);
}
/** Older engines carried previously-journaled partial P&L inside the remainder. */
export async function normalisePaperAccounting(position: PaperPositionRow): Promise<PaperPositionRow> {
  const repo = await getRepo();
  if (await repo.getSetting(`paper-accounting-v2:${position.id}`)) return position;
  const journal = await repo.listJournal({ symbol: position.symbol, mode: "paper", limit: 1_000_000 });
  const alreadyBooked = journal.filter(row => row.openedAt === position.openedAt && row.direction === position.side && row.tags.includes("partial")).reduce((sum,row) => sum + row.pnl,0);
  const next = { ...position, realizedPnl: position.realizedPnl - alreadyBooked };
  await repo.updatePaperPosition(position.id, { realizedPnl: next.realizedPnl });
  await repo.saveSetting(`paper-accounting-v2:${position.id}`, true);
  return next;
}
export async function recordPaperClose(value: JournalInsert, positionId: string, closingEventId = "final"): Promise<JournalRow> {
  const repo = await getRepo();
  const snapshot = await repo.getSetting(`paper-context:${positionId}`) as { source: "demo" | "live"; predictions: PredictionContext[] } | null;
  const row = await repo.insertJournal({ ...value, id: stableUuid(`paper:${positionId}:${closingEventId}`), tags: [...value.tags, ...(snapshot ? [`market-source:${snapshot.source}`] : ["market-source:unknown"])] });
  await repo.saveSetting(`journal-context:${row.id}`, snapshot?.predictions ?? []);
  return row;
}
export async function withJournalContext(rows: JournalRow[]): Promise<(JournalRow & { predictionContext: PredictionContext[] })[]> {
  const repo = await getRepo();
  return Promise.all(rows.map(async row => ({ ...row, predictionContext: await repo.getSetting(`journal-context:${row.id}`) as PredictionContext[] | null ?? [] })));
}
