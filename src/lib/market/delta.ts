/**
 * Delta Exchange India PUBLIC market-data adapter (server-side only).
 *
 * Public endpoints (tickers, candles, order book, trades, products) need no
 * credentials, so they stay on the application as they always were.
 *
 * PRIVATE endpoints no longer exist in this file. Signing moved to the
 * static-IP trading gateway (trading-gateway/src/delta/signing.ts) because
 * Vercel cannot present a dedicated outbound IPv4 for Delta's allowlist, and
 * because the Delta API secret must not exist on Vercel at all. The private
 * paths (wallet, positions, orders) now live in src/lib/tradingGateway.
 *
 * As a guardrail, `http(..., auth: true)` throws: a future edit cannot quietly
 * reintroduce signed calls from here.
 */
import { DELTA_REST_BASE } from "../flags";
import type { Candle, OrderBook, Ticker, Timeframe } from "../types";

export class DeltaError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "DeltaError";
  }
}

const memCache = new Map<string, { at: number; value: unknown }>();

function cached<T>(key: string, ttlMs: number): T | undefined {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  return undefined;
}

function put(key: string, value: unknown) {
  memCache.set(key, { at: Date.now(), value });
  if (memCache.size > 200) {
    const first = memCache.keys().next().value;
    if (first) memCache.delete(first);
  }
}

export async function http(
  method: "GET" | "POST" | "DELETE",
  path: string,
  query: Record<string, string | number | undefined>,
  body: unknown,
  auth: boolean,
  timeoutMs = 8000
): Promise<unknown> {
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${DELTA_REST_BASE}${path}${qs ? `?${qs}` : ""}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "trading-command/1.0",
    Accept: "application/json",
  };
  const bodyStr = body ? JSON.stringify(body) : "";
  if (auth) {
    // Refuse, loudly. Private Delta calls belong on the static-IP gateway:
    // Vercel has no allowlistable egress IP and must never hold the API secret.
    throw new DeltaError(
      "Private Delta endpoints are served by the trading gateway. " +
        "Use src/lib/tradingGateway (gatewayWalletBalances, gatewayPositionsForUnderlying, ...) instead of signing here.",
      501
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: bodyStr || undefined,
      signal: controller.signal,
    });
    if (res.status === 429) throw new DeltaError("Delta API rate limit reached", 429);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new DeltaError(`Delta API error (${res.status})${text ? `: ${text.slice(0, 140)}` : ""}`, res.status);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof DeltaError) throw e;
    if (e instanceof Error && e.name === "AbortError")
      throw new DeltaError("Delta API request timed out");
    throw new DeltaError("Delta API connection failed");
  } finally {
    clearTimeout(timer);
  }
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** GET /v2/tickers — map to internal Ticker shape. */
export async function deltaTickers(symbols?: string[]): Promise<Ticker[]> {
  const key = `tickers:${symbols?.join(",") ?? "all"}`;
  const hit = cached<{ result: Record<string, unknown>[] }>(key, 2000);
  const data = hit ?? (await http("GET", "/v2/tickers", {}, null, false));
  if (!hit) put(key, data);
  const results = (data as { result?: Record<string, unknown>[] }).result ?? [];
  const now = Date.now();
  return results
    .filter((r) => !symbols || symbols.includes(String(r.symbol)))
    .map((r) => {
      const price = num(r.close) ?? num(r.last_price) ?? num(r.mark_price);
      // Delta's /v2/tickers reports the 24h change as `ltp_change_24h` in
      // PERCENT (e.g. -2.1096 means -2.11%). The old code read `change_24h`,
      // which does not exist on this endpoint, so the UI always showed 0.00%.
      const change = num(r.ltp_change_24h) ?? num(r.mark_change_24h);
      return {
        symbol: String(r.symbol ?? ""),
        price: price ?? 0,
        markPrice: num(r.mark_price),
        change24hPct: change ?? 0,
        volume24hUsd: num(r.turnover_usd) ?? num(r.turnover) ?? 0,
        fundingRate: num(r.funding_rate) !== null ? (num(r.funding_rate) as number) * 100 : null,
        openInterest: num(r.oi_value) !== null ? num(r.oi_value) : null,
        high24h: num(r.high_24h) ?? num(r.high),
        low24h: num(r.low_24h) ?? num(r.low),
        bid: num(r.best_bid_price),
        ask: num(r.best_ask_price),
        ts: now,
        source: "delta" as const,
      };
    })
    .filter((t) => t.symbol.endsWith("USD") && t.price > 0);
}

const DELTA_RESOLUTION: Record<Timeframe, string> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1H": "1h", "2H": "2h", "4H": "4h", "1D": "1d", "1W": "1w",
};

/** GET /v2/history/candles — Delta returns oldest-first rows. */
export async function deltaCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
  tfMinutes: number
): Promise<Candle[]> {
  const key = `candles:${symbol}:${timeframe}:${limit}`;
  const hit = cached<{ result: unknown[] }>(key, 10000);
  const end = Math.floor(Date.now() / 1000);
  const start = end - limit * tfMinutes * 60;
  const data =
    hit ??
    (await http(
      "GET",
      "/v2/history/candles",
      { symbol, resolution: DELTA_RESOLUTION[timeframe], start, end },
      null,
      false
    ));
  if (!hit) put(key, data);
  const rows = (data as { result?: unknown[] }).result ?? [];
  // rows: [timestamp, open, high, low, close, volume] (oldest first) or objects
  const candles: Candle[] = rows.map((r) => {
    if (Array.isArray(r)) {
      return {
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5] ?? 0),
      };
    }
    const o = r as Record<string, unknown>;
    return {
      time: Number(o.time ?? o.timestamp),
      open: Number(o.open),
      high: Number(o.high),
      low: Number(o.low),
      close: Number(o.close),
      volume: Number(o.volume ?? 0),
    };
  });
  return candles
    .filter((c) => Number.isFinite(c.close) && c.time > 0)
    .sort((a, b) => a.time - b.time)
    .slice(-limit);
}

/** GET /v2/orderbook */
export async function deltaOrderbook(symbol: string): Promise<OrderBook> {
  const data = (await http("GET", "/v2/orderbook", { symbol, limit: 14 }, null, false)) as {
    buy_book?: { price: string; size: number }[];
    sell_book?: { price: string; size: number }[];
  };
  return {
    symbol,
    bids: (data.buy_book ?? []).map((l) => ({ price: parseFloat(l.price), size: l.size })),
    asks: (data.sell_book ?? []).map((l) => ({ price: parseFloat(l.price), size: l.size })),
    ts: Date.now(),
    source: "delta",
  };
}

/** Lightweight connectivity probe used by the system monitor. */
export async function deltaPing(): Promise<boolean> {
  try {
    await http("GET", "/v2/tickers", { symbol: "BTCUSD" }, null, false, 5000);
    return true;
  } catch {
    return false;
  }
}
