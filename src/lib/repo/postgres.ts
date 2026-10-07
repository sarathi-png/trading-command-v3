/**
 * Postgres (drizzle) repository backend — the original queries, kept intact.
 *
 * The only change is normalisation at the boundary: `Date` columns become
 * ISO-8601 strings so both backends return identical JSON, and callers no
 * longer depend on which backend is active.
 *
 * `@/db` is imported lazily: it throws at module load when DATABASE_URL is
 * absent, and this file must stay importable on a machine with no database.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  alertRulesTable,
  auditLogTable,
  drawingsTable,
  journalTable,
  liveOrdersTable,
  paperOrdersTable,
  paperPositionsTable,
  settingsTable,
  signalsTable,
} from "@/db/schema";
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
  PaperOrderRow,
  PaperPositionInsert,
  PaperPositionRow,
  Repo,
  SignalRow,
} from "./types";

type Db = import("drizzle-orm/node-postgres").NodePgDatabase<typeof import("@/db/schema")>;
let dbPromise: Promise<Db> | null = null;

/** Lazily resolve the drizzle handle; throws if DATABASE_URL is missing. */
export async function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = import("@/db").then((m) => m.db as unknown as Db);
  }
  return dbPromise;
}

const EPOCH = new Date(0).toISOString();
const iso = (v: Date | string | null | undefined, fallback: string): string => {
  if (v === null || v === undefined) return fallback;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
};
const isoOrNull = (v: Date | string | null | undefined): string | null =>
  v === null || v === undefined ? null : iso(v, EPOCH);
const toDate = (v: Date | string | null | undefined): Date | null => {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v : new Date(v);
};
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function toSignal(r: typeof signalsTable.$inferSelect): SignalRow {
  return {
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe as SignalRow["timeframe"],
    strategy: r.strategy,
    status: r.status as SignalRow["status"],
    outcome: r.outcome as SignalRow["outcome"],
    price: r.price,
    entry: r.entry ?? null,
    stop: r.stop ?? null,
    target: r.target ?? null,
    rr: r.rr ?? null,
    reasons: arr<string>(r.reasons),
    createdAt: iso(r.createdAt, EPOCH),
    updatedAt: iso(r.updatedAt, EPOCH),
  };
}

function toJournal(r: typeof journalTable.$inferSelect): JournalRow {
  return {
    id: r.id,
    mode: r.mode as JournalRow["mode"],
    symbol: r.symbol,
    direction: r.direction as JournalRow["direction"],
    entry: r.entry,
    exit: r.exit ?? null,
    qty: r.qty,
    fees: r.fees ?? 0,
    pnl: r.pnl ?? 0,
    strategy: r.strategy ?? "",
    reason: r.reason ?? "",
    notes: r.notes ?? "",
    emotion: r.emotion ?? "",
    tags: arr<string>(r.tags),
    openedAt: iso(r.openedAt, EPOCH),
    closedAt: isoOrNull(r.closedAt),
    source: r.source as JournalRow["source"],
  };
}

function journalValues(v: JournalInsert) {
  return {
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
    openedAt: toDate(v.openedAt) ?? new Date(),
    closedAt: toDate(v.closedAt),
    source: v.source ?? "manual",
  };
}

function journalPnlMatches(
  row: { mode: string; closedAt: string | null },
  filter?: JournalPnlFilter
): boolean {
  if (!filter) return true;
  if (filter.mode && row.mode !== filter.mode) return false;
  if (filter.excludeMode && row.mode === filter.excludeMode) return false;
  if (filter.closedSince) {
    if (!row.closedAt) return false;
    if (row.closedAt < iso(filter.closedSince, "1970-01-01T00:00:00.000Z")) return false;
  }
  return true;
}

/** Cheap probe used to decide whether Postgres is actually usable. */
export async function probePostgres(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

function toPaperOrder(r: typeof paperOrdersTable.$inferSelect): PaperOrderRow {
  return {
    id: r.id,
    symbol: r.symbol,
    side: r.side as PaperOrderRow["side"],
    type: r.type as PaperOrderRow["type"],
    qty: r.qty,
    price: r.price ?? null,
    stopPrice: r.stopPrice ?? null,
    status: r.status as PaperOrderRow["status"],
    filledPrice: r.filledPrice ?? null,
    reduceOnly: r.reduceOnly ?? false,
    createdAt: iso(r.createdAt, EPOCH),
    updatedAt: iso(r.updatedAt, EPOCH),
  };
}

function toPaperPosition(r: typeof paperPositionsTable.$inferSelect): PaperPositionRow {
  return {
    id: r.id,
    symbol: r.symbol,
    side: r.side as PaperPositionRow["side"],
    qty: r.qty,
    entry: r.entry,
    stop: r.stop ?? null,
    target: r.target ?? null,
    realizedPnl: r.realizedPnl ?? 0,
    openedAt: iso(r.openedAt, EPOCH),
    updatedAt: iso(r.updatedAt, EPOCH),
  };
}

function toAlertRule(r: typeof alertRulesTable.$inferSelect): AlertRuleRow {
  return {
    id: r.id,
    symbol: r.symbol,
    kind: r.kind as AlertRuleRow["kind"],
    level: r.level ?? null,
    level2: r.level2 ?? null,
    enabled: r.enabled ?? true,
    sound: r.sound ?? true,
    browser: r.browser ?? false,
    triggeredAt: isoOrNull(r.triggeredAt),
    createdAt: iso(r.createdAt, EPOCH),
  };
}

function toDrawing(r: typeof drawingsTable.$inferSelect): DrawingRow {
  return {
    id: r.id,
    symbol: r.symbol,
    timeframe: r.timeframe as DrawingRow["timeframe"],
    layout: r.layout,
    type: r.type as DrawingRow["type"],
    points: arr<DrawingRow["points"][number]>(r.points),
    color: r.color,
    width: r.width,
    opacity: r.opacity,
    locked: r.locked ?? false,
    hidden: r.hidden ?? false,
    label: r.label ?? "",
    note: r.note ?? "",
    createdAt: iso(r.createdAt, EPOCH),
  };
}

function toLiveOrder(r: typeof liveOrdersTable.$inferSelect): LiveOrderRow {
  return {
    id: r.id,
    clientOrderId: r.clientOrderId,
    symbol: r.symbol,
    side: r.side,
    type: r.type,
    size: r.size,
    price: r.price ?? null,
    status: r.status,
    deltaOrderId: r.deltaOrderId ?? null,
    response: (r.response as Record<string, unknown> | null) ?? null,
    createdAt: iso(r.createdAt, EPOCH),
    updatedAt: iso(r.updatedAt, EPOCH),
  };
}

export const postgresRepo: Repo = {
  backend: "postgres",

  probe() {
    return probePostgres();
  },

  // ---- settings ----
  async getSetting(key) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.key, key))
      .limit(1);
    return rows.length > 0 ? (rows[0].value ?? null) : null;
  },
  async saveSetting(key, value) {
    const db = await getDb();
    await db
      .insert(settingsTable)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  },
  async deleteSetting(key) {
    const db = await getDb();
    await db.delete(settingsTable).where(eq(settingsTable.key, key));
  },

  // ---- audit ----
  async appendAudit(event, detail) {
    const db = await getDb();
    await db.insert(auditLogTable).values({ event, detail });
  },
  async listAudit(limit) {
    const db = await getDb();
    const rows = await db.select().from(auditLogTable).orderBy(desc(auditLogTable.id)).limit(limit);
    return rows.map(
      (r): AuditRow => ({
        id: r.id,
        event: r.event,
        detail: (r.detail ?? {}) as Record<string, unknown>,
        createdAt: iso(r.createdAt, EPOCH),
      })
    );
  },


  // ---- signals ----
  async listSignals(opts) {
    const db = await getDb();
    const limit = opts?.limit ?? 200;
    const rows = opts?.symbol
      ? await db
          .select()
          .from(signalsTable)
          .where(eq(signalsTable.symbol, opts.symbol))
          .orderBy(desc(signalsTable.createdAt))
          .limit(limit)
      : await db.select().from(signalsTable).orderBy(desc(signalsTable.createdAt)).limit(limit);
    return rows.map(toSignal);
  },
  async insertSignal(value) {
    const db = await getDb();
    const [row] = await db
      .insert(signalsTable)
      .values({
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
      })
      .returning();
    return toSignal(row);
  },
  async updateSignal(id, patch) {
    const db = await getDb();
    const [row] = await db
      .update(signalsTable)
      .set({
        status: patch.status,
        outcome: patch.outcome,
        price: patch.price,
        entry: patch.entry,
        stop: patch.stop,
        target: patch.target,
        rr: patch.rr,
        reasons: patch.reasons,
        updatedAt: patch.updatedAt ? toDate(patch.updatedAt) : new Date(),
      })
      .where(eq(signalsTable.id, id))
      .returning();
    return row ? toSignal(row) : null;
  },
  async listActiveSignals(symbol) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(signalsTable)
      .where(and(eq(signalsTable.outcome, "ACTIVE"), eq(signalsTable.symbol, symbol)))
      .orderBy(desc(signalsTable.createdAt));
    return rows.map(toSignal);
  },
  async findActiveSignal(symbol, timeframe, strategy) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(signalsTable)
      .where(
        and(
          eq(signalsTable.symbol, symbol),
          eq(signalsTable.timeframe, timeframe),
          eq(signalsTable.strategy, strategy),
          eq(signalsTable.outcome, "ACTIVE")
        )
      )
      .orderBy(desc(signalsTable.createdAt))
      .limit(1);
    return row ? toSignal(row) : null;
  },

  // ---- journal ----
  async listJournal(opts) {
    const db = await getDb();
    const rows = await db.select().from(journalTable).orderBy(desc(journalTable.openedAt)).limit(800);
    let out = rows.map(toJournal);
    // Historically these filters ran after the query; keep that so the response
    // body is unchanged.
    if (opts?.symbol) out = out.filter((r) => r.symbol === opts.symbol);
    if (opts?.mode) out = out.filter((r) => r.mode === opts.mode);
    return out;
  },
  async insertJournal(value) {
    const db = await getDb();
    const [row] = await db.insert(journalTable).values(journalValues(value)).returning();
    return toJournal(row);
  },
  async insertJournalMany(values) {
    const db = await getDb();
    const rows = values.map(journalValues);
    await db.insert(journalTable).values(rows);
    return rows.length;
  },
  async updateJournal(id, patch) {
    const db = await getDb();
    const [row] = await db
      .update(journalTable)
      .set({
        strategy: patch.strategy,
        reason: patch.reason,
        notes: patch.notes,
        emotion: patch.emotion,
        tags: patch.tags,
        entry: patch.entry,
        exit: patch.exit,
        qty: patch.qty,
        fees: patch.fees,
        pnl: patch.pnl,
      })
      .where(eq(journalTable.id, id))
      .returning();
    return row ? toJournal(row) : null;
  },
  async deleteJournal(id) {
    const db = await getDb();
    await db.delete(journalTable).where(eq(journalTable.id, id));
  },
  async sumJournalPnl(filter) {
    const db = await getDb();
    const rows = await db
      .select({ pnl: journalTable.pnl, mode: journalTable.mode, closedAt: journalTable.closedAt })
      .from(journalTable);
    return rows
      .filter((r) => journalPnlMatches({ mode: r.mode, closedAt: isoOrNull(r.closedAt) }, filter))
      .reduce((a, r) => a + (r.pnl ?? 0), 0);
  },
  async hasAnyJournal() {
    const db = await getDb();
    const rows = await db.select({ id: journalTable.id }).from(journalTable).limit(1);
    return rows.length > 0;
  },


  // ---- paper orders ----
  async listPaperOrders(opts) {
    const db = await getDb();
    const rows = opts?.status
      ? await db
          .select()
          .from(paperOrdersTable)
          .where(eq(paperOrdersTable.status, opts.status))
          .orderBy(desc(paperOrdersTable.createdAt))
      : await db.select().from(paperOrdersTable).orderBy(desc(paperOrdersTable.createdAt));
    return rows.map(toPaperOrder);
  },
  async getPaperOrder(id) {
    const db = await getDb();
    const [row] = await db.select().from(paperOrdersTable).where(eq(paperOrdersTable.id, id));
    return row ? toPaperOrder(row) : null;
  },
  async insertPaperOrder(value) {
    const db = await getDb();
    const [row] = await db
      .insert(paperOrdersTable)
      .values({
        symbol: value.symbol,
        side: value.side,
        type: value.type,
        qty: value.qty,
        price: value.price ?? null,
        stopPrice: value.stopPrice ?? null,
        status: value.status ?? "open",
        filledPrice: value.filledPrice ?? null,
        reduceOnly: value.reduceOnly ?? false,
      })
      .returning();
    return toPaperOrder(row);
  },
  async updatePaperOrder(id, patch) {
    const db = await getDb();
    const [row] = await db
      .update(paperOrdersTable)
      .set({
        status: patch.status,
        filledPrice: patch.filledPrice,
        price: patch.price,
        stopPrice: patch.stopPrice,
        reduceOnly: patch.reduceOnly,
        updatedAt: patch.updatedAt ? toDate(patch.updatedAt) : new Date(),
      })
      .where(eq(paperOrdersTable.id, id))
      .returning();
    return row ? toPaperOrder(row) : null;
  },

  // ---- paper positions ----
  async listPaperPositions() {
    const db = await getDb();
    return (await db.select().from(paperPositionsTable)).map(toPaperPosition);
  },
  async getPaperPositionBySymbol(symbol) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(paperPositionsTable)
      .where(eq(paperPositionsTable.symbol, symbol));
    return row ? toPaperPosition(row) : null;
  },
  async insertPaperPosition(value: PaperPositionInsert) {
    const db = await getDb();
    const values = {
      symbol: value.symbol,
      side: value.side,
      qty: value.qty,
      entry: value.entry,
      stop: value.stop ?? null,
      target: value.target ?? null,
      realizedPnl: value.realizedPnl ?? 0,
    };
    // `symbol` is UNIQUE in Postgres, so inserting an existing symbol is an
    // update — matching the file backend's upsert.
    const [row] = await db
      .insert(paperPositionsTable)
      .values(values)
      .onConflictDoUpdate({
        target: paperPositionsTable.symbol,
        set: { ...values, updatedAt: new Date() },
      })
      .returning();
    return toPaperPosition(row);
  },
  async updatePaperPosition(id, patch) {
    const db = await getDb();
    const [row] = await db
      .update(paperPositionsTable)
      .set({
        side: patch.side,
        qty: patch.qty,
        entry: patch.entry,
        stop: patch.stop,
        target: patch.target,
        realizedPnl: patch.realizedPnl,
        updatedAt: patch.updatedAt ? toDate(patch.updatedAt) : new Date(),
      })
      .where(eq(paperPositionsTable.id, id))
      .returning();
    return row ? toPaperPosition(row) : null;
  },
  async updatePaperPositionBySymbol(symbol, patch) {
    const db = await getDb();
    const rows = await db
      .update(paperPositionsTable)
      .set({
        side: patch.side,
        qty: patch.qty,
        entry: patch.entry,
        stop: patch.stop,
        target: patch.target,
        realizedPnl: patch.realizedPnl,
        updatedAt: patch.updatedAt ? toDate(patch.updatedAt) : new Date(),
      })
      .where(eq(paperPositionsTable.symbol, symbol))
      .returning();
    return rows.map(toPaperPosition);
  },
  async deletePaperPosition(id) {
    const db = await getDb();
    await db.delete(paperPositionsTable).where(eq(paperPositionsTable.id, id));
  },


  // ---- alert rules ----
  async listAlertRules() {
    const db = await getDb();
    return (await db.select().from(alertRulesTable).orderBy(desc(alertRulesTable.createdAt))).map(
      toAlertRule
    );
  },
  async insertAlertRule(value: AlertRuleInsert) {
    const db = await getDb();
    const [row] = await db
      .insert(alertRulesTable)
      .values({
        symbol: value.symbol,
        kind: value.kind,
        level: value.level ?? null,
        level2: value.level2 ?? null,
        enabled: value.enabled ?? true,
        sound: value.sound ?? true,
        browser: value.browser ?? false,
        triggeredAt: toDate(value.triggeredAt),
      })
      .returning();
    return toAlertRule(row);
  },
  async updateAlertRule(id, patch) {
    const db = await getDb();
    const [row] = await db
      .update(alertRulesTable)
      .set({
        enabled: patch.enabled,
        sound: patch.sound,
        browser: patch.browser,
        level: patch.level,
        level2: patch.level2,
        // An explicit null must clear the column, while an absent key leaves it
        // untouched.
        triggeredAt: "triggeredAt" in patch ? toDate(patch.triggeredAt) : undefined,
      })
      .where(eq(alertRulesTable.id, id))
      .returning();
    return row ? toAlertRule(row) : null;
  },
  async deleteAlertRule(id) {
    const db = await getDb();
    await db.delete(alertRulesTable).where(eq(alertRulesTable.id, id));
  },

  // ---- chart drawings ----
  async listDrawings(symbol, timeframe) {
    const db = await getDb();
    const rows = await db
      .select()
      .from(drawingsTable)
      .where(and(eq(drawingsTable.symbol, symbol), eq(drawingsTable.timeframe, timeframe)));
    return rows.map(toDrawing);
  },
  async insertDrawing(value: DrawingInsert) {
    const db = await getDb();
    const [row] = await db
      .insert(drawingsTable)
      .values({
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
      })
      .returning();
    return toDrawing(row);
  },
  async updateDrawing(id, patch) {
    const db = await getDb();
    const [row] = await db
      .update(drawingsTable)
      .set({
        color: patch.color,
        width: patch.width,
        opacity: patch.opacity,
        locked: patch.locked,
        hidden: patch.hidden,
        label: patch.label,
        note: patch.note,
        points: patch.points,
      })
      .where(eq(drawingsTable.id, id))
      .returning();
    return row ? toDrawing(row) : null;
  },
  async deleteDrawing(id) {
    const db = await getDb();
    await db.delete(drawingsTable).where(eq(drawingsTable.id, id));
  },

  // ---- live orders (idempotency ledger) ----
  async findLiveOrderByClientId(clientOrderId) {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(liveOrdersTable)
      .where(eq(liveOrdersTable.clientOrderId, clientOrderId))
      .limit(1);
    return row ? toLiveOrder(row) : null;
  },
  async insertLiveOrder(value: LiveOrderInsert) {
    const db = await getDb();
    await db.insert(liveOrdersTable).values({
      clientOrderId: value.clientOrderId,
      symbol: value.symbol,
      side: value.side,
      type: value.type,
      size: value.size,
      price: value.price ?? null,
      status: value.status ?? "pending",
    });
  },
  async updateLiveOrderByClientId(clientOrderId, patch) {
    const db = await getDb();
    await db
      .update(liveOrdersTable)
      .set({
        status: patch.status,
        deltaOrderId: patch.deltaOrderId,
        response: patch.response,
        updatedAt: patch.updatedAt ? toDate(patch.updatedAt) : new Date(),
      })
      .where(eq(liveOrdersTable.clientOrderId, clientOrderId));
  },
};
