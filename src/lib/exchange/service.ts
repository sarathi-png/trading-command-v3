/**
 * Exchange service — the single entry point for anything that touches a venue.
 *
 *         Browser  →  /api/*  →  src/lib/exchange/service.ts  →  coindcx/*
 *                                                   ↘ (HTTPS)  api.coindcx.com
 *
 * There is no gateway hop, no proxy and no local service: the API routes run as
 * Vercel serverless functions, hold the credentials from the environment and
 * sign each request themselves. That is only possible because CoinDCX does not
 * require an IP-bound key for futures trading (see docs/COINDCX_SETUP.md) — the
 * constraint that forced the previous Delta design.
 *
 * Rules this module keeps, in the same spirit as the code it replaces:
 *   - Secrets are read from `process.env` here and are never returned, logged,
 *     serialised into a response, or exposed to a client bundle. Nothing is
 *     re-exported from a `NEXT_PUBLIC_*` variable and no `"use client"` file may
 *     import this module.
 *   - Reads are cheap and retryable; mutations are attempted once and an
 *     uncertain outcome is reported as UNCERTAIN, never retried.
 *   - Unknown is not zero. `realizedPnlTodayUtc()` returns null when it cannot
 *     prove the figure, and the risk layer blocks on null.
 *   - No long-lived state: the client is stateless, and nothing is cached in
 *     memory across requests except the immutable configuration.
 */
import type {
  ExchangeBalance,
  ExchangeCapabilities,
  ExchangeCandle,
  ExchangeFill,
  ExchangeInstrument,
  ExchangeOrder,
  ExchangeOrderBook,
  ExchangeOrderRequest,
  ExchangePosition,
  ExchangeTicker,
} from "./types";
import { ExchangeError, orderOutcomeKnown } from "./errors";
import { CoinDcxClient } from "./coindcx/client";
import * as coinDcxAccount from "./coindcx/account";
import * as coinDcxMarket from "./coindcx/market";
import * as coinDcxOrders from "./coindcx/orders";
import * as coinDcxPositions from "./coindcx/positions";
import { knownSymbols as coindcxKnownSymbols, toExchangeSymbol, toInternalSymbol } from "./symbols";

export const SUPPORTED_EXCHANGE = "coindcx";
const DEFAULT_BASE_URL = "https://api.coindcx.com";
const DEFAULT_PUBLIC_BASE_URL = "https://public.coindcx.com";

export interface ExchangeConfigState {
  exchange: string;
  /** Both credentials present — the venue can be called. */
  configured: boolean;
  /** Env var names that are missing. Names only, never values. */
  missing: string[];
  baseUrl: string;
  publicBaseUrl: string;
  /** Deltas from the expected configuration (e.g. one key without the other). */
  misconfigured: boolean;
  /** Whether live submission is enabled at all (LIVE_EXECUTION_ENABLED). */
  liveExecutionEnabled: boolean;
}

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

let cached: { fingerprint: string; client: CoinDcxClient } | null = null;

/**
 * Configuration snapshot. Safe to return to an authenticated client: it carries
 * variable NAMES and host names, never a key or a secret.
 */
export function exchangeConfigState(): ExchangeConfigState {
  const apiKey = env("COINDCX_API_KEY");
  const apiSecret = env("COINDCX_API_SECRET");
  const missing: string[] = [];
  if (!apiKey) missing.push("COINDCX_API_KEY");
  if (!apiSecret) missing.push("COINDCX_API_SECRET");
  return {
    exchange: env("EXCHANGE_NAME") || SUPPORTED_EXCHANGE,
    configured: missing.length === 0,
    missing,
    baseUrl: env("COINDCX_BASE_URL") || DEFAULT_BASE_URL,
    publicBaseUrl: env("COINDCX_PUBLIC_BASE_URL") || DEFAULT_PUBLIC_BASE_URL,
    misconfigured: missing.length === 1,
    liveExecutionEnabled: env("LIVE_EXECUTION_ENABLED") === "true" || env("LIVE_EXECUTION_ENABLED") === "1",
  };
}

/** True when private account data can be read. Cheap — no network call. */
export function exchangeConfigured(): boolean {
  return exchangeConfigState().configured;
}

/**
 * The CoinDCX client, rebuilt only when the configuration changes (which in a
 * serverless process means "once"). Stateless, so sharing it is safe.
 */
export function exchangeClient(): CoinDcxClient {
  const state = exchangeConfigState();
  const apiKey = env("COINDCX_API_KEY");
  const apiSecret = env("COINDCX_API_SECRET");
  const fingerprint = `${state.baseUrl}|${state.publicBaseUrl}|${apiKey ? "k" : ""}${apiSecret ? "s" : ""}|${apiKey.length}:${apiSecret.length}`;
  if (cached && cached.fingerprint === fingerprint) return cached.client;
  const client = new CoinDcxClient({
    baseUrl: state.baseUrl,
    publicBaseUrl: state.publicBaseUrl,
    credentials: apiKey && apiSecret ? { apiKey, apiSecret } : null,
    exchange: state.exchange,
  });
  cached = { fingerprint, client };
  return client;
}

/** What the configured venue can do. Drives capability labels in the UI. */
export function exchangeCapabilities(): ExchangeCapabilities {
  return {
    exchange: SUPPORTED_EXCHANGE,
    privateReads: true,
    marketOrders: true,
    limitOrders: true,
    // Not submitted by this build: see coindcx/orders.ts. Position TP/SL goes
    // through positions/create_tpsl, which IS documented.
    stopOrders: false,
    takeProfitStopLoss: true,
    editOrder: true,
    closePosition: true,
    // CoinDCX closes positions via positions/exit; there is no reduce-only flag
    // on order creation, so the app must use the close-position path.
    reduceOnlyOrders: false,
    leverageControl: true,
    // CoinDCX futures has no client order id — idempotency is ours alone.
    clientOrderIds: false,
    publicMarketData: true,
    orderReconciliation: true,
  };
}

// ---------------------------------------------------------------------------
// Public market data — no credentials, no gateway, safe on any deployment.
// ---------------------------------------------------------------------------

export async function marketInstruments(): Promise<ExchangeInstrument[]> {
  return coinDcxMarket.activeInstruments(exchangeClient());
}

export async function marketTickers(symbols?: string[]): Promise<ExchangeTicker[]> {
  return coinDcxMarket.tickers(exchangeClient(), symbols ?? coindcxKnownSymbols());
}

export async function marketCandles(
  symbol: string,
  timeframeSeconds: number,
  limit = 300
): Promise<ExchangeCandle[]> {
  const now = Math.floor(Date.now() / 1000);
  const resolution = coinDcxMarket.resolutionForTimeframe(timeframeSeconds);
  const from = now - timeframeSeconds * Math.min(limit, 1000);
  return coinDcxMarket.candles(exchangeClient(), symbol, { resolution, from, to: now });
}

export async function marketOrderBook(symbol: string, depth: 10 | 20 | 50 = 20): Promise<ExchangeOrderBook> {
  return coinDcxMarket.orderBook(exchangeClient(), symbol, depth);
}

export async function marketRecentTrades(symbol: string): Promise<{ price: number; size: number; side: "buy" | "sell"; ts: number }[]> {
  return coinDcxMarket.recentTrades(exchangeClient(), symbol);
}

/** Cheap liveness probe for /api/system: one unauthenticated call. */
export async function exchangePing(): Promise<{ ok: true; instruments: number }> {
  const instruments = await coinDcxMarket.activeInstruments(exchangeClient());
  return { ok: true, instruments: instruments.length };
}

// ---------------------------------------------------------------------------
// Private reads
// ---------------------------------------------------------------------------

export async function liveBalances(): Promise<ExchangeBalance[]> {
  return coinDcxAccount.walletBalances(exchangeClient());
}

export async function livePositions(): Promise<ExchangePosition[]> {
  return coinDcxPositions.positions(exchangeClient());
}

export async function livePositionFor(symbol: string): Promise<ExchangePosition | null> {
  return coinDcxPositions.positionFor(exchangeClient(), symbol);
}

export async function liveOpenOrders(): Promise<ExchangeOrder[]> {
  return coinDcxOrders.openOrders(exchangeClient());
}

/**
 * Fills for the given symbols over a window.
 *
 * CoinDCX's trades endpoint is per pair, so this fans out across the symbols
 * the app actually watches (the same cost profile as the previous per-underlying
 * position fan-out, and it needs no extra venue capability).
 */
export async function liveFills(options: {
  symbols: string[];
  fromMs: number;
  toMs: number;
  pageSize?: number;
}): Promise<ExchangeFill[]> {
  const client = exchangeClient();
  const out: ExchangeFill[] = [];
  for (const symbol of options.symbols) {
    try {
      const rows = await coinDcxAccount.fills(client, {
        symbol,
        fromMs: options.fromMs,
        toMs: options.toMs,
        page: 1,
        size: options.pageSize ?? 100,
      });
      out.push(...rows);
    } catch (error) {
      // One unsupported pair must not blank the whole analytics panel; the
      // caller sees the rest and the error is raised only if EVERY pair failed.
      if (out.length === 0 && options.symbols.length === 1) throw error;
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export async function liveWalletTransactions(options: { page?: number; size?: number } = {}) {
  return coinDcxAccount.walletTransactions(exchangeClient(), options);
}

export async function livePositionTransactions(options: { stage?: "all" | "default" | "funding"; page?: number; size?: number } = {}) {
  return coinDcxAccount.positionTransactions(exchangeClient(), options);
}

export async function liveOrderStatus(id: string): Promise<ExchangeOrder | null> {
  return coinDcxOrders.findOrderById(exchangeClient(), id);
}

// ---------------------------------------------------------------------------
// Daily realised P&L — feeds the daily-loss risk limit.
// ---------------------------------------------------------------------------

const TRANSACTION_PAGE_SIZE = 200;

/**
 * Realised P&L booked by CoinDCX since UTC midnight, in USDT.
 *
 * Source: POST /positions/transactions, whose documented `amount` field "represents
 * the PnL (Profit and Loss) from this particular transaction". Every closing
 * transaction (stage default/exit/tpsl_exit/liquidation) carries one; funding is
 * excluded because it is a separately-billed cost, not a trade result.
 *
 * FAIL CLOSED — this returns null (which the risk layer treats as "unknown" and
 * therefore blocks) whenever the figure cannot be PROVEN:
 *   - the request fails, or the payload is not a list;
 *   - a page is full, which means the window may be truncated;
 *   - a transaction's `created_at` cannot be parsed, so its day is unknown.
 *
 * A wrong number here is worse than no number: the daily-loss limit is the last
 * line of defence before an account bleeds.
 */
export async function realizedPnlTodayUtc(now: Date = new Date()): Promise<number | null> {
  if (!exchangeConfigured()) return null;
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();

  try {
    const page = await coinDcxAccount.positionTransactions(exchangeClient(), {
      stage: "all",
      page: 1,
      size: TRANSACTION_PAGE_SIZE,
    });
    if (!Array.isArray(page)) return null;
    if (page.length >= TRANSACTION_PAGE_SIZE) return null; // may be truncated

    let total = 0;
    for (const row of page) {
      if (!Number.isFinite(row.createdAt) || row.createdAt <= 0) return null;
      if (row.createdAt < dayStartMs) continue;
      if (row.stage === "funding") continue;
      if (!Number.isFinite(row.amount)) return null;
      total += row.amount;
    }
    return total;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface SubmitOutcome {
  /** "submitted" = venue confirmed an order id; "unknown" = reconcile first. */
  outcome: "submitted" | "unknown";
  order?: ExchangeOrder;
  raw?: unknown;
  error?: ExchangeError;
}

/**
 * Submit one order.
 *
 * NEVER RETRIES. A failure whose outcome is knowable is reported as a normal
 * error; a failure whose outcome is not (`EXCHANGE_UNKNOWN_RESULT`) comes back
 * as `outcome: "unknown"` with the original error, and the caller must
 * reconcile before anything else happens.
 */
export async function submitLiveOrder(request: ExchangeOrderRequest): Promise<SubmitOutcome> {
  try {
    const result = await coinDcxOrders.createOrder(exchangeClient(), request);
    return { outcome: "submitted", order: result.order, raw: result.raw };
  } catch (error) {
    if (error instanceof ExchangeError && !orderOutcomeKnown(error)) {
      return { outcome: "unknown", error };
    }
    throw error;
  }
}

/**
 * Ask the venue what happened to a submission whose response we never saw.
 * Read-only: it lists recent orders and applies the conservative matching rules
 * in coindcx/orders.ts.
 */
export async function reconcileLiveSubmission(request: {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  sinceMs: number;
}): Promise<coinDcxOrders.ReconcileVerdict> {
  if (!exchangeConfigured()) {
    return { status: "unknown", reason: "CoinDCX credentials are not configured, so the order cannot be reconciled.", scanned: 0 };
  }
  return coinDcxOrders.reconcileSubmission(exchangeClient(), request);
}

export async function cancelLiveOrder(id: string): Promise<{ message: string; raw: unknown }> {
  return coinDcxOrders.cancelOrder(exchangeClient(), id);
}

/** Close an open position at market (CoinDCX "quick exit"). */
export async function closeLivePosition(symbol: string): Promise<{ raw: unknown; positionId: string | null }> {
  return coinDcxPositions.exitPosition(exchangeClient(), symbol);
}

export async function setLiveLeverage(symbol: string, leverage: number): Promise<void> {
  return coinDcxPositions.updateLeverage(exchangeClient(), symbol, leverage);
}

/** Attach take-profit/stop-loss to an open position (market legs only). */
export async function setLiveTpSl(input: { symbol: string; takeProfitPrice?: number; stopLossPrice?: number }): Promise<unknown> {
  return coinDcxPositions.createTpSl(exchangeClient(), input);
}

// ---------------------------------------------------------------------------
// Symbol helpers re-exported so callers never import the venue module directly
// ---------------------------------------------------------------------------

export { toExchangeSymbol, toInternalSymbol, toInternalSymbol as toAppSymbol };
export { knownSymbols } from "./symbols";
export { ExchangeError, type ExchangeErrorCode, type ExchangeErrorDetail } from "./errors";
export type { ReconcileVerdict } from "./coindcx/orders";
