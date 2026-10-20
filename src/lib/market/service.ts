/**
 * Unified market data facade.
 *
 * Live mode: served by the exchange adapter (CoinDCX public REST).
 * Errors are surfaced — we never silently substitute stale/demo data for live.
 */
import { demoCandles, demoTicker, demoOrderbook, demoTrades, DEMO_SYMBOLS } from "./demo";
import { validateCandles } from "./validate";
import { cached } from "./cache";
import { UnsupportedTimeframeError } from "../exchange/coindcx/timeframes";
import { flags } from "../flags";
import { getSettings } from "../settings";
import type { Candle, OrderBook, RecentTrade, Ticker, Timeframe } from "../types";
import { TF_MINUTES } from "../types";
import {
  marketCandles,
  marketOrderBook,
  marketRecentTrades,
  marketTickers,
} from "../exchange/service";
import type { ExchangeTicker } from "../exchange/types";

export class MarketError extends Error {}

/** Short enough to feel live, long enough to collapse a page-load fan-out. */
const TICKER_TTL_MS = 2_000;
const CANDLE_TTL_MS = 5_000;
const ORDERBOOK_TTL_MS = 1_000;
const TRADES_TTL_MS = 3_000;

export async function activeDataSource(): Promise<"live" | "demo"> {
  return (await getSettings()).dataSource;
}

export function knownSymbols(): string[] {
  // Use the exchange module's known symbols (all CoinDCX futures pairs)
  const { knownSymbols: exchangeKnownSymbols } = require("../exchange/symbols");
  return exchangeKnownSymbols();
}

/** Exchange ticker → the app's Ticker model (nulls become neutral zeros). */
function toAppTicker(t: ExchangeTicker): Ticker {
  return {
    symbol: t.symbol,
    price: t.price,
    markPrice: t.markPrice,
    change24hPct: t.change24hPct ?? 0,
    change24hAvailable: t.change24hPct !== null,
    volume24hUsd: t.volume24hUsd ?? 0,
    fundingRate: t.fundingRate,
    openInterest: null, // not published on the endpoint this adapter uses
    high24h: t.high24h,
    low24h: t.low24h,
    bid: t.bid,
    ask: t.ask,
    ts: t.ts,
    source: "live",
  };
}

export async function getTickers(symbols?: string[]): Promise<Ticker[]> {
  if (await activeDataSource() === "demo") return (symbols ?? DEMO_SYMBOLS.map(s => s.symbol)).filter(symbol => DEMO_SYMBOLS.some(fixture => fixture.symbol === symbol)).map(demoTicker);
  try {
    const key = `tickers:${(symbols ?? []).slice().sort().join(",") || "all"}`;
    const all = await cached(key, TICKER_TTL_MS, () => marketTickers(symbols));
    return all.map(toAppTicker);
  } catch (e) {
    throw new MarketError(
      e instanceof Error ? e.message : "Exchange market data unavailable"
    );
  }
}

export async function getPrice(symbol: string): Promise<number> {
  const [t] = await getTickers([symbol]);
  if (!t || !t.price) throw new MarketError(`No price available for ${symbol}`);
  return t.price;
}

export async function getCandles(
  symbol: string,
  timeframe: Timeframe,
  limit = 300
): Promise<{ candles: Candle[]; source: "live" | "demo" }> {
  if (await activeDataSource() === "demo") {
    if (!DEMO_SYMBOLS.some(fixture => fixture.symbol === symbol)) throw new MarketError("No demo candle fixture for this symbol. Choose BTC/ETH/SOL/XRP or switch to real CoinDCX market data.");
    return { candles: demoCandles(symbol, timeframe, limit), source: "demo" };
  }
  const seconds = TF_MINUTES[timeframe] * 60;
  let raw: Awaited<ReturnType<typeof marketCandles>>;
  try {
    raw = await cached(
      `candles:${symbol}:${timeframe}:${limit}`,
      CANDLE_TTL_MS,
      () => marketCandles(symbol, seconds, limit)
    );
  } catch (e) {
    // A venue that does not publish this timeframe is a client error, not a
    // provider outage. Never fall back to a different resolution.
    if (e instanceof UnsupportedTimeframeError) throw new MarketError(e.message);
    throw e;
  }
  // Validate at the boundary: downstream indicators assume finite, coherent
  // OHLCV bars, and a single bad bar corrupts every signal derived from it.
  const { candles, rejected } = validateCandles(raw, { timeframeSeconds: seconds });
  if (rejected > 0) {
    console.warn(`[market] dropped ${rejected} invalid ${symbol} ${timeframe} candle(s)`);
  }
  if (candles.length === 0) {
    throw new MarketError(`No candles available for ${symbol} ${timeframe}`);
  }
  return { candles, source: "live" };
}

export async function getOrderbook(symbol: string): Promise<OrderBook> {
  if (!flags.orderbook()) {
    throw new MarketError("Orderbook feature disabled");
  }
  if (await activeDataSource() === "demo") return demoOrderbook(symbol);
  try {
    const book = await cached(`book:${symbol}`, ORDERBOOK_TTL_MS, () => marketOrderBook(symbol, 20));
    return {
      symbol: book.symbol,
      bids: book.bids,
      asks: book.asks,
      ts: book.ts,
      source: "live",
    };
  } catch (e) {
    throw new MarketError(e instanceof Error ? e.message : "Orderbook unavailable");
  }
}

export async function getRecentTrades(symbol: string): Promise<RecentTrade[]> {
  if (await activeDataSource() === "demo") return demoTrades(symbol);
  try {
    return await cached(`trades:${symbol}`, TRADES_TTL_MS, () => marketRecentTrades(symbol));
  } catch (e) {
    throw new MarketError(e instanceof Error ? e.message : "Recent trades unavailable");
  }
}
