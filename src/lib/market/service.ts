/**
 * Unified market-data facade — the single implementation behind every market
 * route and engine read.
 *
 * Live mode is served by the CoinDCX public adapter. Demo mode is served by the
 * deterministic simulator. Both implement `MarketDataProvider` and return a
 * normalized envelope (`provider`, `asOf`, `stale`); errors are surfaced, never
 * silently replaced with stale/demo data.
 */
import { demoCandles, demoTicker, demoOrderbook, demoTrades, DEMO_SYMBOLS } from "./demo";
import { validateCandles } from "./validate";
import { cached } from "@/lib/cache";
import { UnsupportedTimeframeError, isTimeframeSupported } from "../exchange/coindcx/timeframes";
import { knownSymbols as exchangeKnownSymbols } from "../exchange/symbols";
import { flags } from "../flags";
import { getSettings } from "../settings";
import type { Candle, OrderBook, RecentTrade, Ticker, Timeframe } from "../types";
import { TIMEFRAMES, TF_MINUTES } from "../types";
import {
  MARKET_FANOUT_LIMIT,
  type MarketDataProvider,
  type MarketEnvelope,
  type MarketProviderCapabilities,
  type MarketProviderId,
  type MarketSource,
} from "@/lib/data/provider";
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

/** Freshness windows used to mark an envelope stale. */
const TICKER_STALE_MS = 30_000;
const ORDERBOOK_STALE_MS = 5_000;
const TRADES_STALE_MS = 120_000;

export async function activeDataSource(): Promise<MarketSource> {
  return (await getSettings()).dataSource;
}

export function knownSymbols(): string[] {
  return exchangeKnownSymbols();
}

function envelope<T>(
  data: T,
  provider: MarketProviderId,
  source: MarketSource,
  asOf: number,
  stale: boolean
): MarketEnvelope<T> {
  return { data, provider, source, asOf, stale };
}

function asMarketError(e: unknown, fallback: string): MarketError {
  return new MarketError(e instanceof Error ? e.message : fallback);
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

const liveCapabilities: MarketProviderCapabilities = {
  id: "coindcx",
  label: "CoinDCX public futures REST",
  source: "live",
  timeframes: TIMEFRAMES.filter(isTimeframeSupported),
  maxCandles: 1_000,
  orderbook: true,
  recentTrades: true,
  fanoutLimit: MARKET_FANOUT_LIMIT,
};

const demoCapabilities: MarketProviderCapabilities = {
  id: "demo",
  label: "Deterministic demo simulator",
  source: "demo",
  timeframes: [...TIMEFRAMES],
  maxCandles: 1_000,
  orderbook: true,
  recentTrades: true,
  fanoutLimit: MARKET_FANOUT_LIMIT,
};

const liveProvider: MarketDataProvider = {
  capabilities: liveCapabilities,

  async tickers(symbols) {
    try {
      const key = `market:tickers:${(symbols ?? []).slice().sort().join(",") || "all"}`;
      const all = await cached(key, TICKER_TTL_MS, () => marketTickers(symbols));
      const data = all.map(toAppTicker);
      const asOf = data.reduce((max, t) => Math.max(max, t.ts), 0);
      return envelope(data, "coindcx", "live", asOf, data.length === 0 || Date.now() - asOf > TICKER_STALE_MS);
    } catch (e) {
      throw asMarketError(e, "Exchange market data unavailable");
    }
  },

  async candles(symbol, timeframe, limit) {
    const seconds = TF_MINUTES[timeframe] * 60;
    let raw: Awaited<ReturnType<typeof marketCandles>>;
    try {
      raw = await cached(
        `market:candles:${symbol}:${timeframe}:${limit}`,
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
    const last = candles[candles.length - 1];
    const asOf = last.time * 1000;
    return envelope(
      candles,
      "coindcx",
      "live",
      asOf,
      Date.now() - asOf > seconds * 1000 * 3
    );
  },

  async orderbook(symbol) {
    try {
      const book = await cached(`market:book:${symbol}`, ORDERBOOK_TTL_MS, () =>
        marketOrderBook(symbol, 20)
      );
      const data: OrderBook = {
        symbol: book.symbol,
        bids: book.bids,
        asks: book.asks,
        ts: book.ts,
        source: "live",
      };
      return envelope(data, "coindcx", "live", book.ts, Date.now() - book.ts > ORDERBOOK_STALE_MS);
    } catch (e) {
      throw asMarketError(e, "Orderbook unavailable");
    }
  },

  async recentTrades(symbol) {
    try {
      const data = await cached(`market:trades:${symbol}`, TRADES_TTL_MS, () =>
        marketRecentTrades(symbol)
      );
      const asOf = data.reduce((max, t) => Math.max(max, t.ts), 0);
      return envelope(data, "coindcx", "live", asOf, Date.now() - asOf > TRADES_STALE_MS);
    } catch (e) {
      throw asMarketError(e, "Recent trades unavailable");
    }
  },
};

const demoProvider: MarketDataProvider = {
  capabilities: demoCapabilities,

  async tickers(symbols) {
    const wanted = symbols ?? DEMO_SYMBOLS.map((s) => s.symbol);
    const data = wanted
      .filter((symbol) => DEMO_SYMBOLS.some((fixture) => fixture.symbol === symbol))
      .map((symbol) => demoTicker(symbol));
    return envelope(data, "demo", "demo", Date.now(), false);
  },

  async candles(symbol, timeframe, limit) {
    if (!DEMO_SYMBOLS.some((fixture) => fixture.symbol === symbol)) {
      throw new MarketError(
        "No demo candle fixture for this symbol. Choose BTC/ETH/SOL/XRP or switch to real CoinDCX market data."
      );
    }
    const data = demoCandles(symbol, timeframe, limit);
    const last = data[data.length - 1];
    return envelope(data, "demo", "demo", last ? last.time * 1000 : Date.now(), false);
  },

  async orderbook(symbol) {
    const data = demoOrderbook(symbol);
    return envelope(data, "demo", "demo", data.ts, false);
  },

  async recentTrades(symbol) {
    const data = demoTrades(symbol);
    const asOf = data.reduce((max, t) => Math.max(max, t.ts), Date.now());
    return envelope(data, "demo", "demo", asOf, false);
  },
};

async function currentProvider(): Promise<MarketDataProvider> {
  return (await activeDataSource()) === "demo" ? demoProvider : liveProvider;
}

/** Capabilities for `/api/system`; the orderbook flag is deployment-wide. */
export async function marketCapabilities(): Promise<MarketProviderCapabilities> {
  const provider = await currentProvider();
  return { ...provider.capabilities, orderbook: provider.capabilities.orderbook && flags.orderbook() };
}

/** Provenance-carrying ticker read. Use this in routes that expose metadata. */
export async function getTickerEnvelope(symbols?: string[]): Promise<MarketEnvelope<Ticker[]>> {
  return (await currentProvider()).tickers(symbols);
}

export async function getTickers(symbols?: string[]): Promise<Ticker[]> {
  return (await getTickerEnvelope(symbols)).data;
}

export async function getPrice(symbol: string): Promise<number> {
  const [t] = await getTickers([symbol]);
  if (!t || !t.price) throw new MarketError(`No price available for ${symbol}`);
  return t.price;
}

export type CandlesEnvelope = MarketEnvelope<Candle[]> & { candles: Candle[] };

export async function getCandles(
  symbol: string,
  timeframe: Timeframe,
  limit = 300
): Promise<CandlesEnvelope> {
  const env = await (await currentProvider()).candles(symbol, timeframe, limit);
  // `candles` is kept for existing engine callers; the envelope fields are the
  // authoritative provenance for routes and UI.
  return { ...env, candles: env.data };
}

export async function getOrderbook(symbol: string): Promise<OrderBook> {
  if (!flags.orderbook()) {
    throw new MarketError("Orderbook feature disabled");
  }
  return (await (await currentProvider()).orderbook(symbol)).data;
}

export async function getRecentTrades(symbol: string): Promise<RecentTrade[]> {
  return (await (await currentProvider()).recentTrades(symbol)).data;
}
