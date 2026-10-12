import { getCandles } from "@/lib/market/service";
import { flags } from "@/lib/flags";
import { getSettings } from "@/lib/settings";
import { evaluateChandelierDonchian, getSignalState, calculatePositionSize } from "@/lib/strategy/v2/chandelier-donchian";
import { runBacktest } from "@/lib/strategy/v2/backtest";
import type { ChandelierDonchianConfig } from "@/lib/strategy/v2/types";
import { TIMEFRAMES, type Timeframe, type AppSettings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONFIG_CACHE = new Map<string, { config: ChandelierDonchianConfig; ts: number }>();
const CONFIG_TTL = 60_000;

function getStrategyConfig(settings: AppSettings): ChandelierDonchianConfig {
  const cached = CONFIG_CACHE.get("config");
  if (cached && Date.now() - cached.ts < CONFIG_TTL) return cached.config;

  const raw = settings.chandelierDonchian;
  const config: ChandelierDonchianConfig = {
    chandelier: {
      atrLength: raw?.chandelier?.atrLength ?? 20,
      multiplier: raw?.chandelier?.multiplier ?? 3.0,
    },
    donchian: {
      periods: raw?.donchian?.periods ?? [20, 50, 100, 200],
    },
    heikinAshi: raw?.heikinAshi ?? true,
    timeStop: {
      enabled: raw?.timeStop?.enabled ?? true,
      bars: raw?.timeStop?.bars ?? 48,
    },
    risk: {
      leverage: raw?.risk?.leverage ?? 10,
      riskPct: raw?.risk?.riskPct ?? 1.0,
      lotSize: raw?.risk?.lotSize ?? null,
      maxPositions: raw?.risk?.maxPositions ?? 1,
      mode: raw?.risk?.mode ?? "auto",
    },
  };

  CONFIG_CACHE.set("config", { config, ts: Date.now() });
  return config;
}

export async function GET(req: Request) {
  if (!flags.strategyEngine()) {
    return Response.json({ error: "Strategy engine disabled", signal: null });
  }

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "BTCUSD").toUpperCase();
  const tf = url.searchParams.get("timeframe") || "5m";
  if (!TIMEFRAMES.includes(tf as Timeframe)) {
    return Response.json({ error: `Unsupported timeframe: ${tf}` }, { status: 400 });
  }

  const settings = await getSettings();
  const config = getStrategyConfig(settings);

  const candleRes = await getCandles(symbol, tf as Timeframe, 500);
  const candles = candleRes.candles;

  if (candles.length < Math.max(...config.donchian.periods) + 50) {
    return Response.json({
      error: "Insufficient candle data for indicator warmup",
      signal: null,
      required: Math.max(...config.donchian.periods) + 50,
      available: candles.length,
    });
  }

  const signal = evaluateChandelierDonchian(candles, config);
  const state = getSignalState(candles, config);

  let sizing = null;
  if (signal.entry !== null && signal.stop !== null) {
    const equity = 10000;
    sizing = calculatePositionSize(equity, signal.entry, signal.stop, config.risk);
  }

  let backtest = null;
  if (url.searchParams.get("backtest") === "true") {
    try {
      backtest = runBacktest(candles, config);
    } catch {
      backtest = null;
    }
  }

  return Response.json({
    symbol,
    timeframe: tf,
    signal,
    state: {
      haColor: state.haColor,
      donchianTrend: state.donchianState.trend,
      donchianPeriods: state.donchianState.periods,
      chandelierTrend: state.chandelierState.trend,
      chandelierLongStop: state.chandelierState.longStop,
      chandelierShortStop: state.chandelierState.shortStop,
    },
    sizing,
    backtest,
    config,
    source: candleRes.source,
    evaluatedAt: Date.now(),
  });
}