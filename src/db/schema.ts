import {
  pgTable,
  text,
  jsonb,
  boolean,
  real,
  integer,
  timestamp,
  uuid,
  serial,
} from "drizzle-orm/pg-core";

/** Key/value application settings (single-user workstation). */
export const settingsTable = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/** Chart drawings, persisted per symbol + timeframe + layout. */
export const drawingsTable = pgTable("drawings", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  layout: text("layout").notNull().default("default"),
  type: text("type").notNull(),
  points: jsonb("points").notNull(),
  color: text("color").notNull().default("#57E6D2"),
  width: integer("width").notNull().default(2),
  opacity: real("opacity").notNull().default(1),
  locked: boolean("locked").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  label: text("label").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** Every signal the strategy engine has produced. */
export const signalsTable = pgTable("signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  strategy: text("strategy").notNull(),
  status: text("status").notNull(), // WAIT | WATCH | LONG_SETUP | SHORT_SETUP | INVALIDATED
  outcome: text("outcome").notNull().default("ACTIVE"), // ACTIVE | SUPERSEDED | EXPIRED | TRIGGERED | INVALIDATED | MANUAL_OVERRIDE
  price: real("price").notNull(),
  entry: real("entry"),
  stop: real("stop"),
  target: real("target"),
  rr: real("rr"),
  reasons: jsonb("reasons").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/** Trade journal — manual, paper and (future) live records. */
export const journalTable = pgTable("trade_journal", {
  id: uuid("id").primaryKey().defaultRandom(),
  mode: text("mode").notNull().default("paper"), // demo | paper | live
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // long | short
  entry: real("entry").notNull(),
  exit: real("exit"),
  qty: real("qty").notNull(),
  fees: real("fees").notNull().default(0),
  pnl: real("pnl").notNull().default(0),
  strategy: text("strategy").notNull().default(""),
  reason: text("reason").notNull().default(""),
  notes: text("notes").notNull().default(""),
  emotion: text("emotion").notNull().default(""),
  tags: jsonb("tags").notNull().default([]),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  source: text("source").notNull().default("manual"), // manual | paper | seed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** Paper-trading orders (never mixed with live exchange orders). */
export const paperOrdersTable = pgTable("paper_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // buy | sell
  type: text("type").notNull(), // market | limit | stop_market | stop_limit
  qty: real("qty").notNull(),
  price: real("price"),
  stopPrice: real("stop_price"),
  status: text("status").notNull().default("open"), // open | filled | cancelled | rejected
  filledPrice: real("filled_price"),
  reduceOnly: boolean("reduce_only").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/** Paper-trading positions. */
export const paperPositionsTable = pgTable("paper_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull().unique(),
  side: text("side").notNull(), // long | short
  qty: real("qty").notNull(),
  entry: real("entry").notNull(),
  stop: real("stop"),
  target: real("target"),
  realizedPnl: real("realized_pnl").notNull().default(0),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/** Local alert rules evaluated against the live ticker stream. */
export const alertRulesTable = pgTable("alert_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  kind: text("kind").notNull(), // price_above | price_below | zone_enter | signal | pnl_below
  level: real("level"),
  level2: real("level2"),
  enabled: boolean("enabled").notNull().default(true),
  sound: boolean("sound").notNull().default(true),
  browser: boolean("browser").notNull().default(false),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * Live exchange orders.
 *
 * Deliberately separate from paper_orders: paper records must never be mixed
 * with real ones. The unique client_order_id is what makes submission
 * idempotent — a retried request finds the existing row instead of placing a
 * second order with the exchange.
 */
export const liveOrdersTable = pgTable("live_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientOrderId: text("client_order_id").notNull().unique(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  type: text("type").notNull(),
  size: real("size").notNull(),
  price: real("price"),
  status: text("status").notNull().default("pending"), // pending | submitted | unknown | failed
  /** Venue this row was submitted to. Exchange-neutral since the CoinDCX migration. */
  exchange: text("exchange").notNull().default("coindcx"),
  /** Canonical app symbol (e.g. "BTCUSD") and the venue's own pair (e.g. "B-BTC_USDT"). */
  exchangeSymbol: text("exchange_symbol"),
  exchangeOrderId: text("exchange_order_id"),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

/** Append-only audit log of important system/user events. */
export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  event: text("event").notNull(),
  detail: jsonb("detail").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
