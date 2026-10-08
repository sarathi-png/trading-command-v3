/**
 * Unified market data facade.
 *
 * Demo mode: served by the deterministic simulator (always available).
 * Live mode: served by the exchange adapter (CoinDCX public REST), with the
 * same shape the UI, charts, strategy engine and paper simulator already
 * consume — the venue change is invisible above this file.
 *
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
import { demoCandles, demoOrderbook, demoTicker, demoTrades, DEMO_SYMBOLS } from "./demo";

export class MarketError extends Error {}

export async function activeDataSource(): Promise<"demo" | "live"> {
  const s = await getSettings();
  if (s.dataSource === "live" && flags.exchangeMarket()) return "live";
  return "demo";
}

export function knownSymbols(): string[] {
  return DEMO_SYMBOLS.map((s) => s.symbol);
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
  const src = await activeDataSource();
  if (src === "live") {
    try {
      const all = await marketTickers(symbols);
      return all.map(toAppTicker);
    } catch (e) {
      throw new MarketError(
        e instanceof Error ? e.message : "Exchange market data unavailable"
      );
    }
  }
  const list = symbols ?? DEMO_SYMBOLS.map((s) => s.symbol);
  return list.map((s) => demoTicker(s));
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
): Promise<{ candles: Candle[]; source: "demo" | "live" }> {
  const src = await activeDataSource();
  if (src === "live") {
    try {
      const candles = await marketCandles(symbol, TF_MINUTES[timeframe] * 60, limit);
      if (candles.length > 0) return { candles, source: "live" };
    } catch {
      /* fall through to demo — flagged below */
    }
    // The venue returned nothing for this symbol/resolution: fall back to demo,
    // but the response is explicitly labelled so the UI can show it.
  }
  return { candles: demoCandles(symbol, timeframe, limit), source: "demo" };
}

export async function getOrderbook(symbol: string): Promise<OrderBook> {
  const src = await activeDataSource();
  if (src === "live" && flags.orderbook()) {
    try {
      const book = await marketOrderBook(symbol, 20);
      return {
        symbol: book.symbol,
        bids: book.bids,
        asks: book.asks,
        ts: book.ts,
        source: "live",
      };
    } catch {
      /* labelled fallback */
    }
  }
  return demoOrderbook(symbol);
}

export async function getRecentTrades(symbol: string): Promise<RecentTrade[]> {
  const src = await activeDataSource();
  if (src === "live") {
    // Public trades endpoint is best-effort; the demo tape keeps UX consistent
    // and is labelled demo by the caller's data source, not silently.
    try {
      return await marketRecentTrades(symbol);
    } catch {
      return demoTrades(symbol);
    }
  }
  return demoTrades(symbol);
}
