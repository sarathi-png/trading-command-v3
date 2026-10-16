import { getCandles } from "@/lib/market/service";
import { getRepo } from "@/lib/repo";
import { evaluateSetupOutcome, summariseOutcomes, type SetupOutcome } from "@/lib/strategy/v2/outcomes";
import type { Candle, Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface EvaluatedSetup {
  id: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  status: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  createdAt: string;
  outcome: SetupOutcome;
}

/**
 * Recompute what happened after every directional setup the engine recorded.
 * Historical candle coverage is bounded by the data source, so older setups are
 * reported as "unknown" with a reason rather than silently scored as losses.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseInt(url.searchParams.get("limit") || "25", 10);
  const limit = Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : 25, 100);

  try {
    const rows = await (await getRepo()).listSignals({ limit: limit * 4 });
    const directional = rows
      .filter((r) => (r.status === "LONG_SETUP" || r.status === "SHORT_SETUP") && r.entry !== null && r.stop !== null)
      .slice(0, limit);

    const candleCache = new Map<string, Candle[]>();
    const setups: EvaluatedSetup[] = [];

    for (const row of directional) {
      const key = `${row.symbol}|${row.timeframe}`;
      let candles = candleCache.get(key);
      if (!candles) {
        try {
          candles = (await getCandles(row.symbol, row.timeframe as Timeframe, 500)).candles;
        } catch {
          candles = [];
        }
        candleCache.set(key, candles);
      }
      const ts = new Date(row.createdAt).getTime();
      setups.push({
        id: row.id,
        symbol: row.symbol,
        timeframe: row.timeframe,
        strategy: row.strategy,
        status: row.status,
        entry: row.entry,
        stop: row.stop,
        target: row.target,
        rr: row.rr,
        createdAt: row.createdAt,
        outcome: evaluateSetupOutcome(
          { status: row.status, entry: row.entry, stop: row.stop, target: row.target, ts: Number.isFinite(ts) ? ts : Date.now() },
          candles
        ),
      });
    }

    return Response.json({
      setups,
      summary: summariseOutcomes(setups.map((s) => s.outcome)),
      evaluatedAt: Date.now(),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Signal outcomes unavailable", setups: [], summary: null },
      { status: 502 }
    );
  }
}
