/**
 * Market-data provider boundary.
 *
 * A provider is a venue or a simulator that returns normalized envelopes.
 * `market/service.ts` is the only caller: API routes must not reach into
 * `exchange/*` directly for public data. This keeps provenance (`provider`,
 * `asOf`, `stale`) attached to every response and makes the demo/live switch a
 * single selection instead of a branch in every route.
 */
import type { Candle, OrderBook, RecentTrade, Ticker, Timeframe } from "@/lib/types";

export type MarketSource = "live" | "demo";
export type MarketProviderId = "coindcx" | "demo";

/** Every payload carries where it came from and how fresh it is. */
export interface MarketEnvelope<T> {
  data: T;
  provider: MarketProviderId;
  source: MarketSource;
  /** Epoch milliseconds of the newest underlying record. */
  asOf: number;
  /** True when the payload is older than the caller's acceptable window. */
  stale: boolean;
}

export interface MarketProviderCapabilities {
  id: MarketProviderId;
  label: string;
  source: MarketSource;
  /** Timeframes the provider can actually return (not merely the UI list). */
  timeframes: Timeframe[];
  maxCandles: number;
  orderbook: boolean;
  recentTrades: boolean;
  /** Maximum simultaneous per-symbol requests during a fan-out. */
  fanoutLimit: number;
}

export interface MarketDataProvider {
  capabilities: MarketProviderCapabilities;
  tickers(symbols?: string[]): Promise<MarketEnvelope<Ticker[]>>;
  candles(symbol: string, timeframe: Timeframe, limit: number): Promise<MarketEnvelope<Candle[]>>;
  orderbook(symbol: string): Promise<MarketEnvelope<OrderBook>>;
  recentTrades(symbol: string): Promise<MarketEnvelope<RecentTrade[]>>;
}

/** Shared cap for provider fan-outs (movers, per-symbol candles, trades). */
export const MARKET_FANOUT_LIMIT = 3;

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving input order.
 * A rejected item rejects the whole batch, like `Promise.all`.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const width = Math.max(1, Math.min(Math.floor(limit), items.length));
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        out[index] = await fn(items[index], index);
      }
    })
  );
  return out;
}
