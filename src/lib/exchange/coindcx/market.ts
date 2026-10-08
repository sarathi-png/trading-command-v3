/**
 * CoinDCX futures — public market data.
 *
 * Verified endpoints (docs.coindcx.com → Futures End Points):
 *
 *   active instruments  GET  api.coindcx.com/exchange/v1/derivatives/futures/data/active_instruments
 *   recent trades       GET  api.coindcx.com/exchange/v1/derivatives/futures/data/trades?pair=
 *   order book depth    GET  public.coindcx.com/market_data/v3/orderbook/{pair}-futures/{10|20|50}
 *   candlesticks        GET  public.coindcx.com/market_data/candlesticks?pair=&from=&to=&resolution=&pcode=f
 *   live prices         GET  public.coindcx.com/market_data/v3/current_prices/futures/rt
 *
 * None of these need credentials, so none of them can leak one. The venue
 * explicitly recommends its futures websockets for streaming; the REST calls
 * here are the polling fallback the dashboard already uses.
 */
import type { ExchangeCandle, ExchangeInstrument, ExchangeOrderBook, ExchangeTicker } from "../types";
import { instrumentFor, toExchangeSymbol, toInternalSymbol } from "../symbols";
import { ExchangeError } from "../errors";
import { expectArray, num } from "./parse";
import type { CoinDcxClient } from "./client";

interface ActiveInstrumentRow {
  pair?: string;
  symbol?: string;
  base_currency_short_name?: string;
  quote_currency_short_name?: string;
  min_quantity?: number | string;
  max_quantity?: number | string;
  min_notional?: number | string;
  tick_size?: number | string;
  price_tick_size?: number | string;
  quantity_tick_size?: number | string;
  max_leverage?: number | string;
  max_leverage_long?: number | string;
  exit_only?: boolean;
  margin_currency_short_name?: string;
  settlement_currency_short_name?: string;
  instrument_type?: string;
}

/** CoinDCX resolution strings: '1', '5', '15', '60', '1D'. */
export type CoinDcxResolution = "1" | "5" | "15" | "60" | "240" | "1D";

/** App candle timeframe (seconds) → CoinDCX resolution. */
export function resolutionForTimeframe(seconds: number): CoinDcxResolution {
  switch (seconds) {
    case 60:
      return "1";
    case 300:
      return "5";
    case 900:
      return "15";
    case 3600:
      return "60";
    case 14400:
      return "240";
    case 86400:
      return "1D";
    default:
      return "60";
  }
}

/** Live futures instruments (USDT-margined). */
export async function activeInstruments(client: CoinDcxClient): Promise<ExchangeInstrument[]> {
  const rows = await client.publicRead<ActiveInstrumentRow[]>(
    "/exchange/v1/derivatives/futures/data/active_instruments",
    { "margin_currency_short_name[]": "USDT" }
  );
  const list = expectArray<ActiveInstrumentRow>(rows, "/exchange/v1/derivatives/futures/data/active_instruments");
  const out: ExchangeInstrument[] = [];
  for (const row of list) {
    const exchangeSymbol = String(row.pair ?? row.symbol ?? "").toUpperCase();
    if (!exchangeSymbol) continue;
    const internal = toInternalSymbol(exchangeSymbol);
    out.push({
      symbol: internal,
      exchangeSymbol,
      baseAsset: String(row.base_currency_short_name ?? internal.replace(/USD[T]?$/, "")),
      quoteAsset: String(row.quote_currency_short_name ?? "USDT"),
      contractType: row.instrument_type ?? "perpetual",
      settleAsset: String(row.settlement_currency_short_name ?? row.margin_currency_short_name ?? "USDT"),
      tickSize: num(row.price_tick_size ?? row.tick_size, 0) || undefined,
      minQuantity: num(row.min_quantity, 0) || undefined,
      maxLeverage: num(row.max_leverage ?? row.max_leverage_long, 0) || undefined,
      exitOnly: row.exit_only === true,
    });
  }
  return out;
}

/**
 * Recent trades for an instrument. CoinDCX uses this shape for the trade
 * tape; there is no side field, so `is_maker` is surfaced and the caller
 * derives an aggressor side (a maker sell is a buyer-initiated print).
 */
export async function recentTrades(client: CoinDcxClient, symbol: string): Promise<{ price: number; size: number; side: "buy" | "sell"; ts: number }[]> {
  const pair = toExchangeSymbol(symbol, "coindcx");
  const rows = await client.publicRead<{ price?: number; quantity?: number; timestamp?: number; is_maker?: boolean }[]>(
    "/exchange/v1/derivatives/futures/data/trades",
    { pair }
  );
  return expectArray<(typeof rows)[number]>(rows, "/exchange/v1/derivatives/futures/data/trades").map((row) => ({
    price: num(row.price),
    size: num(row.quantity),
    side: row.is_maker === false ? "buy" : "sell",
    ts: num(row.timestamp, Date.now()),
  }));
}

/** Order book (bids/asks) with venue depth buckets 10 / 20 / 50. */
export async function orderBook(client: CoinDcxClient, symbol: string, depth: 10 | 20 | 50 = 20): Promise<ExchangeOrderBook> {
  const pair = toExchangeSymbol(symbol, "coindcx");
  const body = await client.publicDataRead<{
    ts?: number;
    bids?: Record<string, string>;
    asks?: Record<string, string>;
  }>(`/market_data/v3/orderbook/${pair}-futures/${depth}`);

  const toLevels = (levels: Record<string, string> | undefined) =>
    Object.entries(levels ?? {})
      .map(([price, size]) => ({ price: num(price), size: num(size) }))
      .filter((level) => level.price > 0 && level.size > 0)
      .sort((a, b) => b.price - a.price);

  return {
    symbol: symbol.toUpperCase(),
    exchangeSymbol: pair,
    bids: toLevels(body.bids),
    asks: toLevels(body.asks).reverse(),
    ts: num(body.ts, Date.now()),
  };
}

/** OHLCV candles. `from`/`to` are unix SECONDS (CoinDCX uses that unit here). */
export async function candles(
  client: CoinDcxClient,
  symbol: string,
  options: { resolution: CoinDcxResolution; from: number; to: number }
): Promise<ExchangeCandle[]> {
  const pair = toExchangeSymbol(symbol, "coindcx");
  const body = await client.publicDataRead<{ s?: string; data?: { open?: number; high?: number; low?: number; close?: number; volume?: number; time?: number }[] }>(
    "/market_data/candlesticks",
    { pair, from: options.from, to: options.to, resolution: options.resolution, pcode: "f" }
  );
  if (body.s && body.s !== "ok") {
    throw new ExchangeError(
      `CoinDCX returned status "${body.s}" for ${pair} candles.`,
      "EXCHANGE_API_ERROR",
      502,
      { exchange: "coindcx", path: "/market_data/candlesticks", venueCode: String(body.s) }
    );
  }
  return (body.data ?? []).map((bar) => ({
    time: Math.floor(num(bar.time) / 1000),
    open: num(bar.open),
    high: num(bar.high),
    low: num(bar.low),
    close: num(bar.close),
    volume: num(bar.volume),
  }));
}

interface LivePriceRow {
  fr?: number; // funding rate
  h?: number; // 24h high
  l?: number; // 24h low
  v?: number; // 24h volume (USDT notional)
  ls?: number; // last price
  pc?: number; // price change percent
  mp?: number; // mark price
}

/** Input for the demo/paper engines: book snapshot is not available here. */
export async function tickers(client: CoinDcxClient, symbols: string[]): Promise<ExchangeTicker[]> {
  const body = await client.publicDataRead<{ ts?: number; prices?: Record<string, LivePriceRow> }>(
    "/market_data/v3/current_prices/futures/rt"
  );
  const prices = body.prices ?? {};
  const ts = num(body.ts, Date.now());
  const wanted = symbols.length > 0 ? symbols.map((s) => s.toUpperCase()) : Object.keys(prices).map(toInternalSymbol);

  const out: ExchangeTicker[] = [];
  for (const symbol of wanted) {
    let exchangeSymbol: string;
    try {
      exchangeSymbol = toExchangeSymbol(symbol, "coindcx");
    } catch {
      continue; // not a supported instrument on this venue — skip silently
    }
    const row = prices[exchangeSymbol];
    if (!row) continue;
    out.push({
      symbol,
      exchangeSymbol,
      price: num(row.ls, num(row.mp)),
      change24hPct: row.pc === undefined ? null : num(row.pc),
      high24h: row.h === undefined ? null : num(row.h),
      low24h: row.l === undefined ? null : num(row.l),
      volume24hUsd: row.v === undefined ? null : num(row.v),
      bid: null,
      ask: null,
      markPrice: row.mp === undefined ? null : num(row.mp),
      fundingRate: row.fr === undefined ? null : num(row.fr),
      ts,
    });
  }
  return out;
}

/** Convenience for callers that want the descriptor without a network call. */
export function instrument(symbol: string): ExchangeInstrument {
  return instrumentFor(symbol, "coindcx");
}
