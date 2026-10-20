import type { Candle } from "@/lib/types";
import { validateStrategyConfig } from "./types";
import type { ChandelierDonchianConfig, BacktestResult, BacktestTrade, BacktestConfig, HeikinAshiCandle } from "./types";
import { calculatePositionSize, decideSignal, DEFAULT_CHANDELIER_DONCHIAN_CONFIG } from "./chandelier-donchian";
import { toHeikinAshi, haColor } from "./heikin-ashi";
import { donchianRibbon } from "./donchian";
import { chandelierExit } from "./chandelier";

/** Engine config version, stamped onto every result for reproducibility. */
export const BACKTEST_ENGINE_VERSION = "chandelier-donchian-backtest-v1";

/** How results are filled, stated on every result so assumptions travel with the numbers. */
export const FILL_MODEL =
  "Closed-bar signals; next real open fills; prior-bar trailing stops; a gap through the stop fills at the worse opening price; fees and slippage charged per side at the configured rates. No synthetic fills.";

/**
 * Clean a raw candle series for backtesting: drop non-finite values,
 * impossible geometry, duplicate timestamps and non-monotonic ordering.
 * Returns the cleaned series plus human-readable data-quality warnings.
 * Never invents data.
 */
export function sanitizeCandles(raw: Candle[]): { candles: Candle[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!Array.isArray(raw)) return { candles: [], warnings: ["Candle input was not an array."] };
  const seen = new Set<number>();
  const out: Candle[] = [];
  let dropped = 0;
  let duplicates = 0;
  let lastTime = -Infinity;
  for (const c of raw) {
    if (!c || typeof c.time !== "number" || ![c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)) {
      dropped++;
      continue;
    }
    if (c.high < c.low || c.close <= 0 || c.open <= 0) {
      dropped++;
      continue;
    }
    if (seen.has(c.time)) { duplicates++; continue; }
    if (c.time <= lastTime) { dropped++; continue; } // non-monotonic
    seen.add(c.time);
    out.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: Math.max(0, c.volume) });
    lastTime = c.time;
  }
  if (dropped) warnings.push(`${dropped} invalid or out-of-order candles were dropped.`);
  if (duplicates) warnings.push(`${duplicates} duplicate-timestamp candles were dropped.`);
  return { candles: out, warnings };
}

/** Closed-bar signals; next real open fills; prior-bar stops. No synthetic fills. */
export function runBacktest(
  candles: Candle[],
  config: ChandelierDonchianConfig = DEFAULT_CHANDELIER_DONCHIAN_CONFIG,
  backtestConfig: BacktestConfig = DEFAULT_BACKTEST_CONFIG,
  tradeStartIndex = 0,
  dataWarnings: string[] = []
): BacktestResult {
  validateStrategyConfig(config);
  if (!Number.isFinite(backtestConfig.initialCapital) || backtestConfig.initialCapital <= 0 ||
      ![backtestConfig.feeRate, backtestConfig.slippage].every(v => Number.isFinite(v) && v >= 0)) {
    throw new Error("Invalid backtest capital or costs");
  }
  const series: Candle[] = config.heikinAshi ? toHeikinAshi(candles) : candles;
  const indicators = chandelierExit(series, config.chandelier.atrLength, config.chandelier.multiplier);
  const donchian = donchianRibbon(series, config.donchian.periods);
  const trades: BacktestTrade[] = [];
  let stopFirstBars = 0;
  let equity = backtestConfig.initialCapital;
  let peakEquity = equity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let position: BacktestTrade | null = null;
  let activeStop = 0;
  let activeTarget: number | null = null;
  let entryIndex = 0;
  let feesTotal = 0;
  let slippageTotal = 0;
  const equityCurve: { time: number; equity: number }[] = [];
  const mark = (value: number, time: number) => {
    peakEquity = Math.max(peakEquity, value);
    maxDrawdown = Math.max(maxDrawdown, peakEquity - value);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peakEquity - value) / peakEquity * 100);
    equityCurve.push({ time, equity: Number(value.toFixed(2)) });
  };
  const close = (bar: Candle, price: number, reason: BacktestTrade["exitReason"], i: number) => {
    if (!position) return;
    const { pnl, fees, slippage } = calculatePnl(position, price, backtestConfig);
    feesTotal += fees;
    slippageTotal += slippage;
    trades.push({ ...position, exitTime: bar.time, exitPrice: price, pnl,
      pnlPct: pnl / (position.entryPrice * position.qty) * 100,
      exitReason: reason, barsHeld: i - entryIndex + 1 });
    equity += pnl;
    mark(equity, bar.time);
    position = null;
  };
  const pushCurve = (bar: Candle) => {
    const value = equity + (position ? calculatePnl(position, bar.close, backtestConfig).pnl : 0);
    const point = equityCurve.at(-1);
    if (point && point.time === bar.time) point.equity = value;
    else equityCurve.push({ time: bar.time, equity: value });
  };
  const warmup = Math.max(config.chandelier.atrLength, ...config.donchian.periods) + 50;
  for (let i = Math.max(warmup, tradeStartIndex); i < candles.length; i++) {
    const bar = candles[i];
    // The decision uses the previous closed bar only. Its high/low/close cannot
    // affect an opening decision. Indicators are precomputed once above, so the
    // loop is O(bars) instead of recomputing every prefix from bar zero.
    const decisionIndex = i - 1;
    const decisionBar = series[decisionIndex];
    const chandelierTrend = indicators.trend[decisionIndex];
    const chandelierSignal = chandelierTrend === "long" && Number.isFinite(indicators.longStop[decisionIndex])
      ? "buy" as const
      : chandelierTrend === "short" && Number.isFinite(indicators.shortStop[decisionIndex])
        ? "sell" as const
        : "none" as const;
    const signal = decideSignal({
      marketClose: candles[decisionIndex].close,
      timestamp: decisionBar.time,
      chandelierSignal,
      longStop: indicators.longStop[decisionIndex],
      shortStop: indicators.shortStop[decisionIndex],
      donchianTrend: donchian.trend[decisionIndex] ?? "neutral",
      haColor: config.heikinAshi
        ? haColor(decisionBar as HeikinAshiCandle)
        : decisionBar.close >= decisionBar.open ? "green" : "red",
      periods: config.donchian.periods,
    });
    if (position && ((position.side === "long" && signal.status === "SHORT_SETUP") ||
        (position.side === "short" && signal.status === "LONG_SETUP"))) {
      close(bar, position.side === "long"
        ? bar.open * (1 - backtestConfig.slippage)
        : bar.open * (1 + backtestConfig.slippage), "opposite", i);
      pushCurve(bar);
      continue;
    }
    if (!position && equity > 0 && signal.entry !== null && signal.stop !== null &&
        (signal.status === "LONG_SETUP" || signal.status === "SHORT_SETUP")) {
      const side = signal.status === "LONG_SETUP" ? "long" : "short";
      // Slippage is applied to the fill itself (adverse direction), not as a
      // separate cost, so position size and the equity curve see the real fill.
      const entryPrice = side === "long"
        ? bar.open * (1 + backtestConfig.slippage)
        : bar.open * (1 - backtestConfig.slippage);
      if (side === "long" ? entryPrice <= signal.stop : entryPrice >= signal.stop) continue;
      const sizing = calculatePositionSize(equity, entryPrice, signal.stop, {
        ...config.risk, leverage: backtestConfig.leverage, riskPct: backtestConfig.riskPct,
      });
      if (sizing.qty <= 0) continue;
      position = { entryTime: bar.time, exitTime: 0, entryPrice, exitPrice: 0,
        side, qty: sizing.qty, pnl: 0, pnlPct: 0, exitReason: "chandelier", barsHeld: 0 };
      activeStop = signal.stop;
      // The strategy already publishes a 2R target; simulate it instead of
      // silently ignoring it (previous behaviour overstated drawdown/hold time).
      activeTarget = signal.target;
      entryIndex = i;
    }
    if (!position) { pushCurve(bar); continue; }
    const priorStop = position.side === "long" ? indicators.longStop[i - 1] : indicators.shortStop[i - 1];
    if (Number.isFinite(priorStop)) activeStop = position.side === "long"
      ? Math.max(activeStop, priorStop) : Math.min(activeStop, priorStop);
    const stopHit = position.side === "long" ? bar.low <= activeStop : bar.high >= activeStop;
    const targetHit = activeTarget !== null &&
      (position.side === "long" ? bar.high >= activeTarget : bar.low <= activeTarget);
    // When a bar spans both levels the intrabar order is unknowable; assume
    // the stop filled first. That is the conservative bias, never the flattering one.
    if (stopHit) {
      stopFirstBars += targetHit ? 1 : 0;
      // A gap through the stop fills at the worse opening price, plus adverse slippage.
      const raw = position.side === "long" ? Math.min(bar.open, activeStop) : Math.max(bar.open, activeStop);
      close(bar, position.side === "long"
        ? raw * (1 - backtestConfig.slippage)
        : raw * (1 + backtestConfig.slippage), "chandelier", i);
    } else if (targetHit) {
      // A gap beyond the target fills at the (better) opening price.
      close(bar, position.side === "long" ? Math.max(bar.open, activeTarget!) : Math.min(bar.open, activeTarget!), "target", i);
    } else if (config.timeStop.enabled && i - entryIndex + 1 >= config.timeStop.bars) {
      close(bar, position.side === "long"
        ? bar.close * (1 - backtestConfig.slippage)
        : bar.close * (1 + backtestConfig.slippage), "time_stop", i);
    } else {
      mark(equity + calculatePnl(position, bar.close, backtestConfig).pnl, bar.time);
    }
    pushCurve(bar);
  }
  if (position && candles.length) {
    const last = candles.at(-1)!;
    close(last, position.side === "long"
      ? last.close * (1 - backtestConfig.slippage)
      : last.close * (1 + backtestConfig.slippage), "end_of_data", candles.length - 1);
    const point = equityCurve.at(-1);
    if (point && point.time === last.time) point.equity = equity;
    else equityCurve.push({ time: last.time, equity });
  }
  const warnings = [
    "When a bar spans both the stop and the target, the stop is assumed first (conservative).",
  ];
  if (trades.some((trade) => trade.exitReason === "end_of_data")) {
    warnings.push("A position was still open at the last bar and is marked end_of_data, not realized by a venue.");
  }
  if (trades.length < 20) {
    warnings.push(`Only ${trades.length} trade(s): treat every statistic as a small sample.`);
  }
  if (config.timeStop.enabled) warnings.push(`Time stop closes after ${config.timeStop.bars} bar(s).`);
  if (stopFirstBars > 0) warnings.push(`${stopFirstBars} bar(s) touched stop and target; stop-first bias applied.`);
  return computeMetrics(trades, maxDrawdown, maxDrawdownPct, {
    initialCapital: backtestConfig.initialCapital,
    endingEquity: equity,
    fees: feesTotal,
    slippage: slippageTotal,
    equityCurve,
    dataWarnings,
    warnings,
  });
}

function calculatePnl(
  trade: BacktestTrade,
  exitPrice: number,
  config: BacktestConfig
): { pnl: number; fees: number; slippage: number } {
  const grossPnl = trade.side === "long"
    ? (exitPrice - trade.entryPrice) * trade.qty
    : (trade.entryPrice - exitPrice) * trade.qty;

  // Fees are charged on both legs; slippage is already embedded in the fills.
  const fees = (trade.entryPrice + exitPrice) * trade.qty * config.feeRate;
  const slippage = (trade.entryPrice + exitPrice) * trade.qty * config.slippage;

  // Slippage is embedded in the fill prices above; report it, don't charge it twice.
  return { pnl: grossPnl - fees, fees, slippage };
}

interface MetricsExtras {
  initialCapital: number;
  endingEquity: number;
  fees: number;
  slippage: number;
  equityCurve: { time: number; equity: number }[];
  dataWarnings: string[];
  warnings: string[];
}

function computeMetrics(
  trades: BacktestTrade[],
  maxDrawdown: number,
  maxDrawdownPct: number,
  extras: MetricsExtras
): BacktestResult {
  const winningTrades = trades.filter((t) => t.pnl > 0);
  const losingTrades = trades.filter((t) => t.pnl < 0);

  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? winningTrades.length / totalTrades : 0;

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0;

  const avgWin = winningTrades.length > 0 ? grossProfit / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;

  const expectancy = totalTrades > 0
    ? (winRate * avgWin) - ((1 - winRate) * avgLoss)
    : 0;

  const returns = trades.map((t) => t.pnlPct / 100);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const stdReturn = Math.sqrt(
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length || 1)
  );
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) : 0;
  // Trial count and higher moments are not available: do not fabricate DSR.
  const dsr = null;

  const avgHoldBars = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.barsHeld, 0) / trades.length
    : 0;

  const netProfit = extras.endingEquity - extras.initialCapital;

  return {
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: Number((winRate * 100).toFixed(2)),
    expectancy: Number(expectancy.toFixed(4)),
    profitFactor: profitFactor === null ? null : Number(profitFactor.toFixed(2)),
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    dsr: dsr,
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    avgHoldBars: Number(avgHoldBars.toFixed(1)),
    trades,
    initialCapital: extras.initialCapital,
    endingEquity: Number(extras.endingEquity.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    netReturnPct: Number((netProfit / extras.initialCapital * 100).toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    fees: Number(extras.fees.toFixed(2)),
    slippageCost: Number(extras.slippage.toFixed(2)),
    equityCurve: extras.equityCurve,
    fillModel: FILL_MODEL,
    configVersion: BACKTEST_ENGINE_VERSION,
    dataWarnings: extras.dataWarnings,
    warnings: extras.warnings,
  };
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  initialCapital: 10000, leverage: 10, riskPct: 1, feeRate: 0.0005, slippage: 0.0001,
};

/** Fixed-parameter rolling validation, not parameter fitting. Prefix is warmup only. */
export function runWalkForward(candles: Candle[], config: ChandelierDonchianConfig,
  trainWindow = 5000, testWindow = 1000, step = testWindow): BacktestResult[] {
  if (![trainWindow, testWindow, step].every(v => Number.isInteger(v) && v > 0) || step < testWindow) {
    throw new Error("Windows must be positive integers; overlapping test windows are not allowed");
  }
  const results: BacktestResult[] = [];
  for (let start = 0; start + trainWindow + testWindow <= candles.length; start += step) {
    results.push(runBacktest(candles.slice(start, start + trainWindow + testWindow), config,
      DEFAULT_BACKTEST_CONFIG, trainWindow));
  }
  return results;
}

/** Independent windows: report worst window drawdown, not a fabricated compounded curve. */
export function aggregateWalkForward(results: BacktestResult[]): BacktestResult {
  const trades = results.flatMap(r => r.trades);
  const first = results[0];
  const initialCapital = first?.initialCapital ?? DEFAULT_BACKTEST_CONFIG.initialCapital;
  const endingEquity = initialCapital + trades.reduce((sum, t) => sum + t.pnl, 0);
  return computeMetrics(trades, Math.max(0, ...results.map(r => r.maxDrawdown)),
    Math.max(0, ...results.map(r => r.maxDrawdownPct)), {
    initialCapital,
    endingEquity,
    fees: results.reduce((sum, r) => sum + r.fees, 0),
    slippage: results.reduce((sum, r) => sum + r.slippageCost, 0),
    // Per-fold curves have different time axes; the aggregate keeps the
    // trades and the worst-case drawdown instead of a fabricated compound curve.
    equityCurve: [],
    dataWarnings: ["Walk-forward aggregate: per-fold equity curves are reported separately; the combined curve is not compounded."],
    warnings: ["Walk-forward windows are independent; no compounded equity curve is implied."],
  });
}
