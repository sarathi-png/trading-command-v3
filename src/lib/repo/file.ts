/**
 * File (JSON) repository backend.
 *
 * Each Postgres table maps to one JSON document under `data/`. All reads go
 * through the cached `readDoc`; every mutation is serialised per document so a
 * read-modify-write cycle cannot interleave with another request.
 */
import { randomUUID } from "node:crypto";
import { readDoc, writeDoc } from "@/lib/fileStore";
import type {
  AlertRuleInsert,
  AlertRuleRow,
  AuditRow,
  DrawingInsert,
  DrawingRow,
  JournalInsert,
  JournalPnlFilter,
  JournalRow,
  LiveOrderInsert,
  LiveOrderRow,
  PaperOrderInsert,
  PaperOrderRow,
  PaperPositionInsert,
  PaperPositionRow,
  Repo,
  SettingRow,
  SignalInsert,
  SignalRow,
  Timestamp,
} from "./types";

export const DOC_SETTINGS = "settings.json";
export const DOC_AUDIT = "audit.json";
export const DOC_SIGNALS = "signals.json";
export const DOC_JOURNAL = "journal.json";
export const DOC_PAPER_ORDERS = "paper_orders.json";
export const DOC_PAPER_POSITIONS = "paper_positions.json";
export const DOC_ALERTS = "alerts.json";
export const DOC_DRAWINGS = "drawings.json";
export const DOC_LIVE_ORDERS = "live_orders.json";

/** Every document the mirror may push upstream (see lib/hfSync.ts). */
export const ALL_DOCS = [
  DOC_SETTINGS,
  DOC_AUDIT,
  DOC_SIGNALS,
  DOC_JOURNAL,
  DOC_PAPER_ORDERS,
  DOC_PAPER_POSITIONS,
  DOC_ALERTS,
  DOC_DRAWINGS,
  DOC_LIVE_ORDERS,
] as const;

/** Serialises mutations per document (writeDoc only serialises the writes). */
const locks = new Map<string, Promise<unknown>>();

function lock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(
    name,
    next.catch(() => undefined)
  );
  return next;
}

async function mutate<T>(name: string, fallback: T, fn: (rows: T) => T | null): Promise<T> {
  return lock(name, async () => {
    const rows = readDoc<T>(name, fallback);
    const next = fn(rows);
    if (next === null) return rows;
    await writeDoc(name, next);
    return next;
  });
}

function now(): Timestamp {
  return new Date().toISOString();
}

/** Accept both `Date` and ISO strings on insert; always store ISO strings. */
function ts(value: Date | string | null | undefined, fallback: string): string;
function ts(value: Date | string | null | undefined, fallback: null): string | null;
function ts(value: Date | string | null | undefined, fallback: string | null): string | null {
  if (value === null || value === undefined) return fallback;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

function byTimeDesc(a: { createdAt?: string; openedAt?: string }, b: { createdAt?: string; openedAt?: string }): number {
  const av = a.createdAt ?? a.openedAt ?? "";
  const bv = b.createdAt ?? b.openedAt ?? "";
  return bv.localeCompare(av);
}


function matchesJournal(row: JournalRow, filter?: JournalPnlFilter): boolean {
  if (!filter) return true;
  if (filter.mode && row.mode !== filter.mode) return false;
  if (filter.excludeMode && row.mode === filter.excludeMode) return false;
  if (filter.closedSince) {
    if (!row.closedAt) return false;
    const since = ts(filter.closedSince, "1970-01-01T00:00:00.000Z") as string;
    if (row.closedAt < since) return false;
  }
  return true;
}

function listSignalsFile(opts?: { symbol?: string; limit?: number }): SignalRow[] {
  const rows = readDoc<SignalRow[]>(DOC_SIGNALS, []);
  const filtered = opts?.symbol ? rows.filter((r) => r.symbol === opts.symbol) : rows;
  return [...filtered].sort(byTimeDesc).slice(0, opts?.limit ?? 200);
}

function normaliseJournal(v: JournalInsert): JournalRow {
  return {
    id: v.id ?? randomUUID(),
    mode: v.mode,
    symbol: v.symbol,
    direction: v.direction,
    entry: v.entry,
    exit: v.exit ?? null,
    qty: v.qty,
    fees: v.fees ?? 0,
    pnl: v.pnl ?? 0,
    strategy: v.strategy ?? "",
    reason: v.reason ?? "",
    notes: v.notes ?? "",
    emotion: v.emotion ?? "",
    tags: v.tags ?? [],
    openedAt: ts(v.openedAt, now()),
    closedAt: ts(v.closedAt, null),
    source: v.source ?? "manual",
  };
}

/** Replace one row by id; returns `null` so `mutate` skips the write. */
function replaceById<T extends { id: string }>(rows: T[], id: string, patch: Partial<T>): T[] | null {
  const idx = rows.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const next = rows.slice();
  next[idx] = { ...rows[idx], ...patch, id: rows[idx].id };
  return next;
}

export const fileRepo: Repo = {
  backend: "file",

  /** The data directory is created on first write, so writing is the probe. */
  async probe() {
    try {
      return await writeDoc(".health", { at: now() });
    } catch {
      return false;
    }
  },

  // ---- settings ----
  async getSetting(key) {
    const doc = readDoc<Record<string, SettingRow>>(DOC_SETTINGS, {});
    return doc[key]?.value ?? null;
  },
  async saveSetting(key, value) {
    await mutate<Record<string, SettingRow>>(DOC_SETTINGS, {}, (doc) => ({
      ...doc,
      [key]: { key, value, updatedAt: now() },
    }));
  },
  async deleteSetting(key) {
    await mutate<Record<string, SettingRow>>(DOC_SETTINGS, {}, (doc) => {
      if (!(key in doc)) return null;
      const next = { ...doc };
      delete next[key];
      return next;
    });
  },

  // ---- audit ----
  async appendAudit(event, detail) {
    await mutate<AuditRow[]>(DOC_AUDIT, [], (rows) => {
      const nextId = rows.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
      // Bound the mirror file: the UI only ever reads the newest 120 events.
      return [{ id: nextId, event, detail, createdAt: now() }, ...rows].slice(0, 2000);
    });
  },
  async listAudit(limit) {
    return readDoc<AuditRow[]>(DOC_AUDIT, [])
      .sort((a, b) => (b.id || 0) - (a.id || 0))
      .slice(0, limit);
  },

  // ---- signals ----
  async listSignals(opts) {
    return listSignalsFile(opts);
  },
  async insertSignal(value) {
    const createdAt = ts(value.createdAt, now());
    const row: SignalRow = {
      id: value.id ?? randomUUID(),
      symbol: value.symbol,
      timeframe: value.timeframe,
      strategy: value.strategy,
      status: value.status,
      outcome: value.outcome ?? "ACTIVE",
      price: value.price,
      entry: value.entry ?? null,
      stop: value.stop ?? null,
      target: value.target ?? null,
      rr: value.rr ?? null,
      reasons: value.reasons ?? [],
      createdAt,
      updatedAt: ts(value.updatedAt, createdAt),
    };
    await mutate<SignalRow[]>(DOC_SIGNALS, [], (rows) => [row, ...rows]);
    return row;
  },
  async updateSignal(id, patch) {
    let updated: SignalRow | null = null;
    await mutate<SignalRow[]>(DOC_SIGNALS, [], (rows) => {
      const next = replaceById(rows, id, patch);
      if (next) updated = next.find((r) => r.id === id) ?? null;
      return next;
    });
    return updated;
  },
  async listActiveSignals(symbol) {
    return listSignalsFile({ symbol, limit: 500 }).filter((r) => r.outcome === "ACTIVE");
  },
  async findActiveSignal(symbol, timeframe, strategy) {
    return (
      listSignalsFile({ symbol, limit: 500 })
        .filter((r) => r.outcome === "ACTIVE" && r.timeframe === timeframe && r.strategy === strategy)
        .sort(byTimeDesc)[0] ?? null
    );
  },

  // ---- journal ----
  async listJournal(opts) {
    let rows = readDoc<JournalRow[]>(DOC_JOURNAL, []);
    if (opts?.symbol) rows = rows.filter((r) => r.symbol === opts.symbol);
    if (opts?.mode) rows = rows.filter((r) => r.mode === opts.mode);
    return [...rows].sort(byTimeDesc).slice(0, opts?.limit ?? 800);
  },
  async insertJournal(value) {
    const row = normaliseJournal(value);
    await mutate<JournalRow[]>(DOC_JOURNAL, [], (rows) => [row, ...rows]);
    return row;
  },
  async insertJournalMany(values) {
    const stamped = values.map(normaliseJournal);
    await mutate<JournalRow[]>(DOC_JOURNAL, [], (rows) => [...stamped, ...rows]);
    return stamped.length;
  },
  async updateJournal(id, patch) {
    let updated: JournalRow | null = null;
    await mutate<JournalRow[]>(DOC_JOURNAL, [], (rows) => {
      const next = replaceById(rows, id, patch);
      if (next) updated = next.find((r) => r.id === id) ?? null;
      return next;
    });
    return updated;
  },
  async deleteJournal(id) {
    await mutate<JournalRow[]>(DOC_JOURNAL, [], (rows) => {
      const next = rows.filter((r) => r.id !== id);
      return next.length === rows.length ? null : next;
    });
  },
  async sumJournalPnl(filter) {
    return readDoc<JournalRow[]>(DOC_JOURNAL, [])
      .filter((r) => matchesJournal(r, filter))
      .reduce((a, r) => a + (r.pnl ?? 0), 0);
  },
  async hasAnyJournal() {
    return readDoc<JournalRow[]>(DOC_JOURNAL, []).length > 0;
  },

  // ---- paper orders ----
  async listPaperOrders(opts) {
    const rows = readDoc<PaperOrderRow[]>(DOC_PAPER_ORDERS, []);
    const filtered = opts?.status ? rows.filter((r) => r.status === opts.status) : rows;
    return [...filtered].sort(byTimeDesc);
  },
  async getPaperOrder(id) {
    return readDoc<PaperOrderRow[]>(DOC_PAPER_ORDERS, []).find((r) => r.id === id) ?? null;
  },
  async insertPaperOrder(value) {
    const created = ts(value.createdAt, now());
    const row: PaperOrderRow = {
      id: value.id ?? randomUUID(),
      symbol: value.symbol,
      side: value.side,
      type: value.type,
      qty: value.qty,
      price: value.price ?? null,
      stopPrice: value.stopPrice ?? null,
      status: value.status ?? "open",
      filledPrice: value.filledPrice ?? null,
      reduceOnly: value.reduceOnly ?? false,
      createdAt: created,
      updatedAt: ts(value.updatedAt, created),
    };
    await mutate<PaperOrderRow[]>(DOC_PAPER_ORDERS, [], (rows) => [row, ...rows]);
    return row;
  },
  async updatePaperOrder(id, patch) {
    let updated: PaperOrderRow | null = null;
    await mutate<PaperOrderRow[]>(DOC_PAPER_ORDERS, [], (rows) => {
      const next = replaceById(rows, id, patch);
      if (next) updated = next.find((o) => o.id === id) ?? null;
      return next;
    });
    return updated;
  },

  // ---- paper positions ----
  async listPaperPositions() {
    return readDoc<PaperPositionRow[]>(DOC_PAPER_POSITIONS, []);
  },
  async getPaperPositionBySymbol(symbol) {
    return (
      readDoc<PaperPositionRow[]>(DOC_PAPER_POSITIONS, []).find((p) => p.symbol === symbol) ?? null
    );
  },
  async insertPaperPosition(value) {
    const created = ts(value.openedAt, now());
    const row: PaperPositionRow = {
      id: value.id ?? randomUUID(),
      symbol: value.symbol,
      side: value.side,
      qty: value.qty,
      entry: value.entry,
      stop: value.stop ?? null,
      target: value.target ?? null,
      realizedPnl: value.realizedPnl ?? 0,
      openedAt: created,
      updatedAt: ts(value.updatedAt, created),
    };
    await mutate<PaperPositionRow[]>(DOC_PAPER_POSITIONS, [], (rows) => {
      // `symbol` is UNIQUE in Postgres — upsert rather than duplicate.
      if (rows.some((p) => p.symbol === row.symbol)) return rows.map((p) => (p.symbol === row.symbol ? row : p));
      return [...rows, row];
    });
    return row;
  },
  async updatePaperPosition(id, patch) {
    let updated: PaperPositionRow | null = null;
    await mutate<PaperPositionRow[]>(DOC_PAPER_POSITIONS, [], (rows) => {
      const next = replaceById(rows, id, patch);
      if (next) updated = next.find((p) => p.id === id) ?? null;
      return next;
    });
    return updated;
  },
  async updatePaperPositionBySymbol(symbol, patch) {
    const touched: PaperPositionRow[] = [];
    await mutate<PaperPositionRow[]>(DOC_PAPER_POSITIONS, [], (rows) => {
      const next = rows.map((p) => (p.symbol === symbol ? { ...p, ...patch } : p));
      for (const p of next) if (p.symbol === symbol) touched.push(p);
      return next.some((p, i) => p !== rows[i]) ? next : null;
    });
    return touched;
  },
  async deletePaperPosition(id) {
    await mutate<PaperPositionRow[]>(DOC_PAPER_POSITIONS, [], (rows) => {
      const next = rows.filter((p) => p.id !== id);
      return next.length === rows.length ? null : next;
    });
  },

  // ---- alert rules ----
  async listAlertRules() {
    return [...readDoc<AlertRuleRow[]>(DOC_ALERTS, [])].sort(byTimeDesc);
  },
  async insertAlertRule(value) {
    const row: AlertRuleRow = {
      id: value.id ?? randomUUID(),
      symbol: value.symbol,
      kind: value.kind,
      level: value.level ?? null,
      level2: value.level2 ?? null,
      enabled: value.enabled ?? true,
      sound: value.sound ?? true,
      browser: value.browser ?? false,
      triggeredAt: ts(value.triggeredAt, null),
      createdAt: ts(value.createdAt, now()),
    };
    await mutate<AlertRuleRow[]>(DOC_ALERTS, [], (rows) => [row, ...rows]);
    return row;
  },
  async updateAlertRule(id, patch) {
    let updated: AlertRuleRow | null = null;
    await mutate<AlertRuleRow[]>(DOC_ALERTS, [], (rows) => {
      const next = replaceById(rows, id, patch);
      if (next) updated = next.find((r) => r.id === id) ?? null;
      return next;
    });
    return updated;
  },
  async deleteAlertRule(id) {
    await mutate<AlertRuleRow[]>(DOC_ALERTS, [], (rows) => {
      const next = rows.filter((r) => r.id !== id);
      return next.length === rows.length ? null : next;
    });
  },

  // ---- chart drawings ----
  async listDrawings(symbol, timeframe) {
    return readDoc<DrawingRow[]>(DOC_DRAWINGS, []).filter(
      (d) => d.symbol === symbol && d.timeframe === timeframe
    );
  },
  async insertDrawing(value) {
    const row: DrawingRow = {
      id: value.id ?? randomUUID(),
      symbol: value.symbol,
      timeframe: value.timeframe,
      layout: value.layout,
      type: value.type,
      points: value.points,
      color: value.color,
      width: value.width,
      opacity: value.opacity,
      locked: value.locked,
      hidden: value.hidden,
      label: value.label,
      note: value.note,
      createdAt: ts(value.createdAt, now()),
    };
    await mutate<DrawingRow[]>(DOC_DRAWINGS, [], (rows) => [...rows, row]);
    return row;
  },
  async updateDrawing(id, patch) {
    let updated: DrawingRow | null = null;
    await mutate<DrawingRow[]>(DOC_DRAWINGS, [], (rows) => {
      const next = replaceById(rows, id, patch);
      if (next) updated = next.find((d) => d.id === id) ?? null;
      return next;
    });
    return updated;
  },
  async deleteDrawing(id) {
    await mutate<DrawingRow[]>(DOC_DRAWINGS, [], (rows) => {
      const next = rows.filter((d) => d.id !== id);
      return next.length === rows.length ? null : next;
    });
  },

  // ---- live orders (idempotency ledger) ----
  async findLiveOrderByClientId(clientOrderId) {
    return (
      readDoc<LiveOrderRow[]>(DOC_LIVE_ORDERS, []).find(
        (o) => o.clientOrderId === clientOrderId
      ) ?? null
    );
  },
  async insertLiveOrder(value) {
    const created = ts(value.createdAt, now());
    const row: LiveOrderRow = {
      id: value.id ?? randomUUID(),
      clientOrderId: value.clientOrderId,
      symbol: value.symbol,
      side: value.side,
      type: value.type,
      size: value.size,
      price: value.price ?? null,
      status: value.status ?? "pending",
      exchange: value.exchange ?? "coindcx",
      symbolCanonical: value.symbolCanonical ?? value.symbol,
      exchangeSymbol: value.exchangeSymbol ?? null,
      exchangeOrderId: value.exchangeOrderId ?? null,
      response: value.response ?? null,
      createdAt: created,
      updatedAt: ts(value.updatedAt, created),
    };
    await mutate<LiveOrderRow[]>(DOC_LIVE_ORDERS, [], (rows) => [row, ...rows]);
  },
  async updateLiveOrderByClientId(clientOrderId, patch) {
    await mutate<LiveOrderRow[]>(DOC_LIVE_ORDERS, [], (rows) => {
      const idx = rows.findIndex((o) => o.clientOrderId === clientOrderId);
      if (idx === -1) return null;
      const next = rows.slice();
      next[idx] = { ...rows[idx], ...patch, clientOrderId: rows[idx].clientOrderId };
      return next;
    });
  },
};
