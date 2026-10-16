import { dispatchNotice } from "@/lib/notifications/service";
import { getAccountState } from "@/lib/account";
import { getCandles } from "@/lib/market/service";
import { flags } from "@/lib/flags";
import { getSettings } from "@/lib/settings";
import { evaluateChandelierDonchian, getSignalState, calculatePositionSize } from "@/lib/strategy/v2/chandelier-donchian";
import { runBacktest } from "@/lib/strategy/v2/backtest";
import type { ChandelierDonchianConfig } from "@/lib/strategy/v2/types";
import { TIMEFRAMES, TF_MINUTES, type Timeframe, type AppSettings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getStrategyConfig(settings: AppSettings): ChandelierDonchianConfig {
  const raw = settings.chandelierDonchian;
  const config: ChandelierDonchianConfig = {
    chandelier: {
      atrLength: raw?.chandelier?.atrLength ?? 1,
      multiplier: raw?.chandelier?.multiplier ?? 2.0,
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

  try {
  const settings = await getSettings();
  const config = getStrategyConfig(settings);
  if (url.searchParams.get("chartType") === "heikin-ashi") config.heikinAshi = true;
  if (url.searchParams.get("chartType") === "candles") config.heikinAshi = false;

  const candleRes = await getCandles(symbol, tf as Timeframe, 500);
  const candles = candleRes.candles.filter(c => (c.time + TF_MINUTES[tf as Timeframe] * 60) * 1000 <= Date.now());

  if (candles.length < Math.max(...config.donchian.periods) + 50) {
    return Response.json({
      error: "Insufficient candle data for indicator warmup",
      signal: null,
      required: Math.max(...config.donchian.periods) + 50,
      available: candles.length,
    });
  }

  const signal = evaluateChandelierDonchian(candles, config);
  signal.symbol = symbol;
  signal.timeframe = tf as Timeframe;
  const state = getSignalState(candles, config);

  let sizing = null;
  let sizingSource: string | null = null;
  if (signal.entry !== null && signal.stop !== null && settings.mode !== "live") {
    const account = await getAccountState();
    // Never size a live order using fallback paper equity.
    if (account.source === "demo") {
      sizing = calculatePositionSize(account.equity, signal.entry, signal.stop, config.risk);
      sizingSource = "Simulated account equity; estimate only";
    }

  }

  let backtest = null;
  if (url.searchParams.get("backtest") === "true") {
    try {
      backtest = runBacktest(candles, config, { initialCapital: settings.startingBalance, leverage: config.risk.leverage, riskPct: config.risk.riskPct, feeRate: 0.0005, slippage: 0.0001 });
    } catch {
      backtest = null;
    }
  }

  if (tf === "5m" && config.heikinAshi && (signal.status === "LONG_SETUP" || signal.status === "SHORT_SETUP")) {
    await dispatchNotice({ symbol, timeframe: tf, chart: "heikin-ashi", strategy: "Chandelier Exit + Donchian trend", direction: signal.status === "LONG_SETUP" ? "LONG" : "SHORT", barTime: signal.ts, source: candleRes.source, entry: signal.entry, stop: signal.stop, target: signal.target, reasons: signal.reasons });
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
    sizingSource,
    backtest,
    config,
    source: candleRes.source,
    evaluatedAt: Date.now(),
  });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Strategy unavailable" }, { status: 502 });
  }
}