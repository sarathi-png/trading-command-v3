import type { Candle, Timeframe } from "@/lib/types";
import type {
  ChandelierDonchianConfig,
  BacktestResult,
  BacktestTrade,
  BacktestConfig,
} from "./types";
import { evaluateChandelierDonchian, getSignalState, calculatePositionSize, DEFAULT_CHANDELIER_DONCHIAN_CONFIG } from "./chandelier-donchian";
import { toHeikinAshi } from "./heikin-ashi";

export function runBacktest(
  candles: Candle[],
  config: ChandelierDonchianConfig = DEFAULT_CHANDELIER_DONCHIAN_CONFIG,
  backtestConfig: BacktestConfig = DEFAULT_BACKTEST_CONFIG
): BacktestResult {
  const haCandles = config.heikinAshi ? toHeikinAshi(candles) : candles;
  const trades: BacktestTrade[] = [];
  let equity = backtestConfig.initialCapital;
  let peakEquity = equity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let position: BacktestTrade | null = null;
  let barsSinceEntry = 0;

  for (let i = Math.max(...config.donchian.periods) + 50; i < haCandles.length; i++) {
    const currentCandle = haCandles[i];
    const lookbackCandles = haCandles.slice(0, i + 1);

    if (position) {
      barsSinceEntry++;
      const exitResult = checkExit(position, currentCandle, lookbackCandles, config, barsSinceEntry);
      if (exitResult) {
        const { exitPrice, exitReason } = exitResult;
        const pnl = calculatePnl(position, exitPrice, backtestConfig);
        const pnlPct = (pnl / (position.entryPrice * position.qty)) * 100;

        trades.push({
          ...position,
          exitTime: currentCandle.time,
          exitPrice,
          pnl,
          pnlPct,
          exitReason,
          barsHeld: barsSinceEntry,
        });

        equity += pnl;
        peakEquity = Math.max(peakEquity, equity);
        const dd = peakEquity - equity;
        const ddPct = (dd / peakEquity) * 100;
        maxDrawdown = Math.max(maxDrawdown, dd);
        maxDrawdownPct = Math.max(maxDrawdownPct, ddPct);

        position = null;
        barsSinceEntry = 0;
      }
    }

    if (!position && trades.length < backtestConfig.initialCapital * 10) {
      const signal = evaluateChandelierDonchian(lookbackCandles, config);
      if (signal.status === "LONG_SETUP" || signal.status === "SHORT_SETUP") {
        const entryPrice = signal.entry!;
        const stopPrice = signal.stop!;
        const targetPrice = signal.target!;
        const side = signal.status === "LONG_SETUP" ? "long" : "short";

        const sizing = calculatePositionSize(equity, entryPrice, stopPrice, config.risk);

        position = {
          entryTime: currentCandle.time,
          exitTime: 0,
          entryPrice,
          exitPrice: 0,
          side,
          qty: sizing.qty,
          pnl: 0,
          pnlPct: 0,
          exitReason: "chandelier",
          barsHeld: 0,
        };
        barsSinceEntry = 1;
      }
    }
  }

  if (position) {
    const lastCandle = haCandles[haCandles.length - 1];
    const pnl = calculatePnl(position, lastCandle.close, backtestConfig);
    const pnlPct = (pnl / (position.entryPrice * position.qty)) * 100;
    trades.push({
      ...position,
      exitTime: lastCandle.time,
      exitPrice: lastCandle.close,
      pnl,
      pnlPct,
      exitReason: "end_of_data",
      barsHeld: barsSinceEntry,
    });
    equity += pnl;
  }

  return computeMetrics(trades, backtestConfig.initialCapital, maxDrawdown, maxDrawdownPct);
}

function checkExit(
  position: BacktestTrade,
  currentCandle: Candle,
  lookbackCandles: Candle[],
  config: ChandelierDonchianConfig,
  barsSinceEntry: number
): { exitPrice: number; exitReason: BacktestTrade["exitReason"] } | null {
  const signal = evaluateChandelierDonchian(lookbackCandles, config);

  if (config.timeStop.enabled && barsSinceEntry >= config.timeStop.bars) {
    return { exitPrice: currentCandle.close, exitReason: "time_stop" };
  }

  if (position.side === "long") {
    if (signal.status === "SHORT_SETUP") {
      return { exitPrice: currentCandle.close, exitReason: "opposite" };
    }
    if (signal.stop !== null && currentCandle.low <= signal.stop) {
      return { exitPrice: signal.stop, exitReason: "chandelier" };
    }
  } else {
    if (signal.status === "LONG_SETUP") {
      return { exitPrice: currentCandle.close, exitReason: "opposite" };
    }
    if (signal.stop !== null && currentCandle.high >= signal.stop) {
      return { exitPrice: signal.stop, exitReason: "chandelier" };
    }
  }

  return null;
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
  initialCapital: number,
  maxDrawdown: number,
  maxDrawdownPct: number
): BacktestResult {
  const winningTrades = trades.filter((t) => t.pnl > 0);
  const losingTrades = trades.filter((t) => t.pnl < 0);

  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? winningTrades.length / totalTrades : 0;

  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

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
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252 * 288) : 0;
  // Deflated Sharpe Ratio: adjusts for multiple testing / selection bias.
  // When sharpe is 0 or the adjustment is degenerate, report 0 (not NaN).
  const sr = Math.max(-1, Math.min(1, sharpeRatio));
  const dsr = sr > 0
    ? sr * Math.sqrt((1 - 0.5) / Math.max(1e-9, 1 - 0.5 * sr * sr))
    : 0;

  const avgHoldBars = trades.length > 0
    ? trades.reduce((sum, t) => sum + t.barsHeld, 0) / trades.length
    : 0;

  return {
    totalTrades,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: Number((winRate * 100).toFixed(2)),
    expectancy: Number(expectancy.toFixed(4)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    dsr: Number(dsr.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    avgHoldBars: Number(avgHoldBars.toFixed(1)),
    trades,
  };
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  initialCapital: 10000,
  leverage: 10,
  riskPct: 1.0,
  feeRate: 0.0005,
  slippage: 0.0001,
};

export function runWalkForward(
  candles: Candle[],
  config: ChandelierDonchianConfig,
  trainWindow: number = 5000,
  testWindow: number = 1000,
  step: number = 500
): BacktestResult[] {
  const results: BacktestResult[] = [];

  for (let start = 0; start + trainWindow + testWindow < candles.length; start += step) {
    const trainCandles = candles.slice(start, start + trainWindow);
    const testCandles = candles.slice(start + trainWindow, start + trainWindow + testWindow);

    if (testCandles.length < 100) break;

    const result = runBacktest(testCandles, config);
    results.push(result);
  }

  return results;
}

export function aggregateWalkForward(results: BacktestResult[]): BacktestResult {
  if (!results.length) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      expectancy: 0,
      profitFactor: 0,
      maxDrawdown: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      dsr: 0,
      avgWin: 0,
      avgLoss: 0,
      avgHoldBars: 0,
      trades: [],
    };
  }

  const allTrades = results.flatMap((r) => r.trades);
  const totalTrades = allTrades.length;
  const winningTrades = allTrades.filter((t) => t.pnl > 0).length;
  const losingTrades = allTrades.filter((t) => t.pnl < 0).length;
  const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

  const grossProfit = allTrades.filter((t) => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(allTrades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  const avgWin = winningTrades > 0 ? grossProfit / winningTrades : 0;
  const avgLoss = losingTrades > 0 ? grossLoss / losingTrades : 0;
  const expectancy = totalTrades > 0 ? (winRate / 100 * avgWin) - ((1 - winRate / 100) * avgLoss) : 0;

  const returns = allTrades.map((t) => t.pnlPct / 100);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const stdReturn = Math.sqrt(
    returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length || 1)
  );
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252 * 288) : 0;
  const sr = Math.max(-1, Math.min(1, sharpeRatio));
  const dsr = sr > 0
    ? sr * Math.sqrt((1 - 0.5) / Math.max(1e-9, 1 - 0.5 * sr * sr))
    : 0;

  const avgHoldBars = allTrades.length > 0
    ? allTrades.reduce((sum, t) => sum + t.barsHeld, 0) / allTrades.length
    : 0;

  let peakEquity = 0;
  let equity = 0;
  let maxDD = 0;
  let maxDDPct = 0;
  for (const t of allTrades) {
    equity += t.pnl;
    peakEquity = Math.max(peakEquity, equity);
    const dd = peakEquity - equity;
    const ddPct = peakEquity > 0 ? (dd / peakEquity) * 100 : 0;
    maxDD = Math.max(maxDD, dd);
    maxDDPct = Math.max(maxDDPct, ddPct);
  }

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    winRate: Number(winRate.toFixed(2)),
    expectancy: Number(expectancy.toFixed(4)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdown: Number(maxDD.toFixed(2)),
    maxDrawdownPct: Number(maxDDPct.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    dsr: Number(dsr.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    avgHoldBars: Number(avgHoldBars.toFixed(1)),
    trades: allTrades,
  };
}