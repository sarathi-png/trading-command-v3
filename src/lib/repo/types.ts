/**
 * Repository contract shared by the Postgres (drizzle) and file (JSON) backends.
 *
 * Row shapes mirror the Postgres tables exactly as the API has always returned
 * them, with one deliberate normalisation: **every timestamp is an ISO-8601
 * string**, never a `Date`. JSON serialisation of a `Date` also produces an ISO
 * string, so the HTTP response bodies are identical between backends, and
 * callers no longer depend on which backend is active.
 */
import type { DrawingPoint, DrawingType, SignalOutcome, SignalStatus, Timeframe } from "@/lib/types";

export type Timestamp = string; // ISO-8601
export type MaybeTs = Timestamp | null;

export interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: Timestamp;
}

export interface AuditRow {
  id: number;
  event: string;
  detail: Record<string, unknown>;
  createdAt: Timestamp;
}

export interface SignalRow {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  strategy: string;
  status: SignalStatus;
  outcome: SignalOutcome;
  price: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  reasons: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SignalInsert = Omit<SignalRow, "id" | "createdAt" | "updatedAt"> &
  Partial<Pick<SignalRow, "id" | "createdAt" | "updatedAt">>;

export interface JournalRow {
  id: string;
  mode: "demo" | "paper" | "live";
  symbol: string;
  direction: "long" | "short";
  entry: number;
  exit: number | null;
  qty: number;
  fees: number;
  pnl: number;
  strategy: string;
  reason: string;
  notes: string;
  emotion: string;
  tags: string[];


  openedAt: Timestamp;
  closedAt: MaybeTs;
  source: "manual" | "paper" | "seed";
}

/** Insert payload: `id`/timestamps are optional, and dates may be `Date`s. */
export type JournalInsert = Omit<JournalRow, "id" | "openedAt" | "closedAt"> & {
  id?: string;
  openedAt?: Timestamp | Date;
  closedAt?: Timestamp | Date | null;
};


export interface Repo {
  /** Which backend actually served this repository: `"postgres"` or `"file"`. */
  readonly backend: "postgres" | "file";
  /** Cheap liveness probe used by /api/health and /api/system. */
  probe(): Promise<boolean>;

  // ---- settings (key/value) ----
  getSetting(key: string): Promise<unknown | null>;
  saveSetting(key: string, value: unknown): Promise<void>;
  deleteSetting(key: string): Promise<void>;

  // ---- audit log ----
  appendAudit(event: string, detail: Record<string, unknown>): Promise<void>;
  listAudit(limit: number): Promise<AuditRow[]>;

  // ---- signals ----
  listSignals(opts?: { symbol?: string; limit?: number }): Promise<SignalRow[]>;
  insertSignal(value: SignalInsert): Promise<SignalRow>;
  updateSignal(id: string, patch: Partial<SignalRow>): Promise<SignalRow | null>;
  listActiveSignals(symbol: string): Promise<SignalRow[]>;
  findActiveSignal(symbol: string, timeframe: string, strategy: string): Promise<SignalRow | null>;

  // ---- journal ----
  listJournal(opts?: { symbol?: string; mode?: string; limit?: number }): Promise<JournalRow[]>;
  insertJournal(value: JournalInsert): Promise<JournalRow>;
  insertJournalMany(values: JournalInsert[]): Promise<number>;
  updateJournal(id: string, patch: Partial<JournalRow>): Promise<JournalRow | null>;
  deleteJournal(id: string): Promise<void>;
  sumJournalPnl(filter?: JournalPnlFilter): Promise<number>;
  hasAnyJournal(): Promise<boolean>;

  // ---- paper orders ----
  listPaperOrders(opts?: { status?: string }): Promise<PaperOrderRow[]>;
  getPaperOrder(id: string): Promise<PaperOrderRow | null>;
  insertPaperOrder(value: PaperOrderInsert): Promise<PaperOrderRow>;
  updatePaperOrder(id: string, patch: Partial<PaperOrderRow>): Promise<PaperOrderRow | null>;

  // ---- paper positions ----
  listPaperPositions(): Promise<PaperPositionRow[]>;
  getPaperPositionBySymbol(symbol: string): Promise<PaperPositionRow | null>;
  insertPaperPosition(value: PaperPositionInsert): Promise<PaperPositionRow>;
  updatePaperPosition(id: string, patch: Partial<PaperPositionRow>): Promise<PaperPositionRow | null>;
  updatePaperPositionBySymbol(symbol: string, patch: Partial<PaperPositionRow>): Promise<PaperPositionRow[]>;
  deletePaperPosition(id: string): Promise<void>;

  // ---- alert rules ----
  listAlertRules(): Promise<AlertRuleRow[]>;
  insertAlertRule(value: AlertRuleInsert): Promise<AlertRuleRow>;
  updateAlertRule(id: string, patch: Partial<AlertRuleRow>): Promise<AlertRuleRow | null>;
  deleteAlertRule(id: string): Promise<void>;

  // ---- chart drawings ----
  listDrawings(symbol: string, timeframe: string): Promise<DrawingRow[]>;
  insertDrawing(value: DrawingInsert): Promise<DrawingRow>;
  updateDrawing(id: string, patch: Partial<DrawingRow>): Promise<DrawingRow | null>;
  deleteDrawing(id: string): Promise<void>;

  // ---- live orders (idempotency ledger) ----
  findLiveOrderByClientId(clientOrderId: string): Promise<LiveOrderRow | null>;
  insertLiveOrder(value: LiveOrderInsert): Promise<void>;
  updateLiveOrderByClientId(clientOrderId: string, patch: Partial<LiveOrderRow>): Promise<void>;
}
export interface PaperOrderRow {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop_market" | "stop_limit";
  qty: number;
  price: number | null;
  stopPrice: number | null;
  status: "open" | "filled" | "cancelled" | "rejected";
  filledPrice: number | null;
  reduceOnly: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type PaperOrderInsert = Omit<
  PaperOrderRow,
  "id" | "createdAt" | "updatedAt" | "filledPrice"
> & {
  id?: string;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
  filledPrice?: number | null;
};

export interface PaperPositionRow {
  id: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  stop: number | null;
  target: number | null;
  realizedPnl: number;
  openedAt: Timestamp;
  updatedAt: Timestamp;
}

export type PaperPositionInsert = Omit<
  PaperPositionRow,
  "id" | "openedAt" | "updatedAt" | "stop" | "target"
> & {
  id?: string;
  openedAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
  stop?: number | null;
  target?: number | null;
};

export interface AlertRuleRow {
  id: string;
  symbol: string;
  kind: "price_above" | "price_below" | "zone_enter" | "signal" | "pnl_below";
  level: number | null;
  level2: number | null;
  enabled: boolean;
  sound: boolean;
  browser: boolean;
  triggeredAt: MaybeTs;
  createdAt: Timestamp;
}

export type AlertRuleInsert = Omit<AlertRuleRow, "id" | "createdAt" | "triggeredAt"> & {
  id?: string;
  createdAt?: Timestamp | Date;
  triggeredAt?: Timestamp | Date | null;
};

export interface DrawingRow {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  layout: string;
  type: DrawingType;
  points: DrawingPoint[];
  color: string;
  width: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  label: string;
  note: string;
  createdAt: Timestamp;
}

export type DrawingInsert = Omit<DrawingRow, "id" | "createdAt"> & {
  id?: string;
  createdAt?: Timestamp | Date;
};

export interface LiveOrderRow {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: string;
  type: string;
  size: number;
  price: number | null;
  status: string;
  /** Venue the order was submitted to ("coindcx"). */
  exchange: string;
  /** Canonical symbol the app ordered, e.g. "BTCUSD". */
  symbolCanonical: string;
  /** Venue pair identifier, e.g. "B-BTC_USDT". */
  exchangeSymbol: string | null;
  exchangeOrderId: string | null;
  response: Record<string, unknown> | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type LiveOrderInsert = Omit<
  LiveOrderRow,
  "id" | "createdAt" | "updatedAt" | "exchange" | "symbolCanonical" | "exchangeSymbol" | "exchangeOrderId" | "response"
> & {
  id?: string;
  createdAt?: Timestamp | Date;
  updatedAt?: Timestamp | Date;
  exchange?: string;
  /** Defaults to `symbol` when omitted. */
  symbolCanonical?: string;
  exchangeSymbol?: string | null;
  exchangeOrderId?: string | null;
  response?: Record<string, unknown> | null;
};

export interface JournalPnlFilter {
  /** Only count entries in this mode. */
  mode?: string;
  /** Skip this mode (e.g. `demo`, which is synthetic and must not affect P&L). */
  excludeMode?: string;
  /** Only count entries closed at/after this instant. */
  closedSince?: Date | string;
}
