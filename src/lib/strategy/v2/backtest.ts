import type { Candle } from "@/lib/types";
import { validateStrategyConfig } from "./types";
import type { ChandelierDonchianConfig, BacktestResult, BacktestTrade, BacktestConfig } from "./types";
import { evaluateChandelierDonchian, calculatePositionSize, DEFAULT_CHANDELIER_DONCHIAN_CONFIG } from "./chandelier-donchian";
import { toHeikinAshi } from "./heikin-ashi";
import { chandelierExit } from "./chandelier";

/** Closed-bar signals; next real open fills; prior-bar stops. No synthetic fills. */
export function runBacktest(
  candles: Candle[],
  config: ChandelierDonchianConfig = DEFAULT_CHANDELIER_DONCHIAN_CONFIG,
  backtestConfig: BacktestConfig = DEFAULT_BACKTEST_CONFIG,
  tradeStartIndex = 0
): BacktestResult {
  validateStrategyConfig(config);
  if (!Number.isFinite(backtestConfig.initialCapital) || backtestConfig.initialCapital <= 0 ||
      ![backtestConfig.feeRate, backtestConfig.slippage].every(v => Number.isFinite(v) && v >= 0)) {
    throw new Error("Invalid backtest capital or costs");
  }
  const indicators = chandelierExit(config.heikinAshi ? toHeikinAshi(candles) : candles,
    config.chandelier.atrLength, config.chandelier.multiplier);
  const trades: BacktestTrade[] = [];
  let equity = backtestConfig.initialCapital;
  let peakEquity = equity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let position: BacktestTrade | null = null;
  let activeStop = 0;
  let entryIndex = 0;
  const mark = (value: number) => {
    peakEquity = Math.max(peakEquity, value);
    maxDrawdown = Math.max(maxDrawdown, peakEquity - value);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peakEquity - value) / peakEquity * 100);
  };
  const close = (bar: Candle, price: number, reason: BacktestTrade["exitReason"], i: number) => {
    if (!position) return;
    const pnl = calculatePnl(position, price, backtestConfig);
    trades.push({ ...position, exitTime: bar.time, exitPrice: price, pnl,
      pnlPct: pnl / (position.entryPrice * position.qty) * 100,
      exitReason: reason, barsHeld: i - entryIndex + 1 });
    equity += pnl;
    mark(equity);
    position = null;
  };
  const warmup = Math.max(config.chandelier.atrLength, ...config.donchian.periods) + 50;
  for (let i = Math.max(warmup, tradeStartIndex); i < candles.length; i++) {
    const bar = candles[i];
    // slice excludes this bar: its high/low/close cannot affect an opening decision.
    const signal = evaluateChandelierDonchian(candles.slice(0, i), config);
    if (position && ((position.side === "long" && signal.status === "SHORT_SETUP") ||
        (position.side === "short" && signal.status === "LONG_SETUP"))) {
      close(bar, bar.open, "opposite", i);
      continue;
    }
    if (!position && equity > 0 && signal.entry !== null && signal.stop !== null &&
        (signal.status === "LONG_SETUP" || signal.status === "SHORT_SETUP")) {
      const side = signal.status === "LONG_SETUP" ? "long" : "short";
      if (side === "long" ? bar.open <= signal.stop : bar.open >= signal.stop) continue;
      const sizing = calculatePositionSize(equity, bar.open, signal.stop, {
        ...config.risk, leverage: backtestConfig.leverage, riskPct: backtestConfig.riskPct,
      });
      if (sizing.qty <= 0) continue;
      position = { entryTime: bar.time, exitTime: 0, entryPrice: bar.open, exitPrice: 0,
        side, qty: sizing.qty, pnl: 0, pnlPct: 0, exitReason: "chandelier", barsHeld: 0 };
      activeStop = signal.stop;
      entryIndex = i;
    }
    if (!position) continue;
    const priorStop = position.side === "long" ? indicators.longStop[i - 1] : indicators.shortStop[i - 1];
    if (Number.isFinite(priorStop)) activeStop = position.side === "long"
      ? Math.max(activeStop, priorStop) : Math.min(activeStop, priorStop);
    if (position.side === "long" ? bar.low <= activeStop : bar.high >= activeStop) {
      // A gap through the stop fills at the worse opening price.
      close(bar, position.side === "long" ? Math.min(bar.open, activeStop) : Math.max(bar.open, activeStop), "chandelier", i);
    } else if (config.timeStop.enabled && i - entryIndex + 1 >= config.timeStop.bars) {
      close(bar, bar.close, "time_stop", i);
    } else {
      mark(equity + calculatePnl(position, bar.close, backtestConfig));
    }
  }
  if (position && candles.length) close(candles.at(-1)!, candles.at(-1)!.close, "end_of_data", candles.length - 1);
  return computeMetrics(trades, maxDrawdown, maxDrawdownPct);
}

function calculatePnl(
  trade: BacktestTrade,
  exitPrice: number,
  config: BacktestConfig
): number {
  const grossPnl = trade.side === "long"
    ? (exitPrice - trade.entryPrice) * trade.qty
    : (trade.entryPrice - exitPrice) * trade.qty;

  const fees = (trade.entryPrice + exitPrice) * trade.qty * config.feeRate;
  const slippage = (trade.entryPrice + exitPrice) * trade.qty * config.slippage;

  return grossPnl - fees - slippage;
}

function computeMetrics(
  trades: BacktestTrade[],
  maxDrawdown: number,
  maxDrawdownPct: number
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
  return computeMetrics(trades, Math.max(0, ...results.map(r => r.maxDrawdown)),
    Math.max(0, ...results.map(r => r.maxDrawdownPct)));
}
