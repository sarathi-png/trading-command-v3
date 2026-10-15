import { activeDataSource, getCandles, getTickers } from "./service";
import {
  rankMovers,
  assessMover,
  type MoverRow,
  type MoversReport,
} from "./movers";
let cached: MoversReport | null = null;
let work: Promise<MoversReport> | null = null;
export async function moversReport(): Promise<MoversReport> {
  const source = await activeDataSource();
  if (cached?.source === source && Date.now() - cached.asOf < 60_000)
    return cached;
  if (work) {
    const result = await work;
    if (result.source === source) return result;
  }
  work = build(source);
  try {
    cached = await work;
    return cached;
  } finally {
    work = null;
  }
}
async function build(source: "live" | "demo"): Promise<MoversReport> {
  const tickers = await getTickers();
  if (tickers.some((t) => t.source !== source))
    throw Error("Data source changed; refresh the report.");
  const rank = rankMovers(tickers);
  const queue = [...rank.gainers, ...rank.losers];
  const rows = new Map<string, MoverRow>();
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (index < queue.length) {
        const ticker = queue[index++];
        try {
          const data = await getCandles(ticker.symbol, "5m", 500);
          if (data.source !== source) throw Error("Source changed");
          rows.set(ticker.symbol, {
            ticker,
            assessment: assessMover(ticker.symbol, data.candles),
          });
        } catch {
          rows.set(ticker.symbol, {
            ticker,
            assessment: {
              stance: "WAIT",
              reasons: [
                "Candle analysis unavailable. A 24-hour move alone is not a trade signal.",
              ],
              entry: null,
              stop: null,
              barTime: null,
            },
          });
        }
      }
    }),
  );
  return {
    gainers: rank.gainers.map((t) => rows.get(t.symbol)!),
    losers: rank.losers.map((t) => rows.get(t.symbol)!),
    source,
    universe: tickers.length,
    excluded: rank.excluded,
    asOf: Date.now(),
    scope:
      source === "demo"
        ? "Simulated demo universe only; not a live coin ranking."
        : "Supported CoinDCX futures universe on this deployment, not all crypto exchanges.",
  };
}
