/**
 * Unified market data facade.
 *
 * Live mode: served by the exchange adapter (CoinDCX public REST).
 * Errors are surfaced — we never silently substitute stale/demo data for live.
 */
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

export async function activeDataSource(): Promise<"live"> {
  return "live";
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
  try {
    const all = await marketTickers(symbols);
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
): Promise<{ candles: Candle[]; source: "live" }> {
  const candles = await marketCandles(symbol, TF_MINUTES[timeframe] * 60, limit);
  if (candles.length === 0) {
    throw new MarketError(`No candles available for ${symbol} ${timeframe}`);
  }
  return { candles, source: "live" };
}

export async function getOrderbook(symbol: string): Promise<OrderBook> {
  if (!flags.orderbook()) {
    throw new MarketError("Orderbook feature disabled");
  }
  try {
    const book = await marketOrderBook(symbol, 20);
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
  try {
    return await marketRecentTrades(symbol);
  } catch (e) {
    throw new MarketError(e instanceof Error ? e.message : "Recent trades unavailable");
  }
}
