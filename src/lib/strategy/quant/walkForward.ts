/**
 * Event-driven backtester for the trend-following core.
 *
 * Reconciliation with the live engine:
 *   - Entry decisions come from trend.ts `trendSignalAt` (the same function live uses).
 *   - Both LONG and SHORT are simulated.
 *   - Higher-timeframe context is real HTF data, aligned by close time (no look-ahead).
 *
 * Execution model (documented assumptions):
 *   - Signal at the close of bar i; market entry at the open of bar i+1 with adverse slippage.
 *   - Stop-market exits. Gap-through fills at the open (adverse), not at the stop.
 *   - Within a bar, if the stop is touched it is assumed hit before any ratchet from that bar.
 *   - Trailing stop ratchets using bars that have CLOSED (bar j's extreme moves the stop from j+1).
 *   - One position at a time. Time stop closes at the close of the final bar.
 *
 * All results are in R (multiples of the initial risk), net of fees and funding.
 */
import type { Candle } from "@/lib/types";
import { atr as atrSeries } from "./indicators";
import { feesPrice, fundingPrice, type CostModel } from "./costs";
import { prepareTrend, trendSignalAt, type TrendParams, type TrendContext } from "./trend";

export interface Trade {
  side: 1 | -1;
  entryIdx: number;
  exitIdx: number;
  entryTime: number;
  exitTime: number;
  entry: number;        // filled price (includes slippage)
  exit: number;
  initialStop: number;
  riskPrice: number;    // |entry - initialStop|
  grossR: number;       // price P&L after slippage, before fees/funding
  netR: number;         // after fees and funding
  bars: number;
  reason: "STOP" | "TIME";
}

export interface BacktestConfig {
  params: TrendParams;
  costs: CostModel;
  ltfSec: number;
  htfSec: number;
  entryMaker?: boolean; // default false; maker entries assume a fill at the open, which is optimistic
}

const slipUp = (p: number, c: CostModel) => p * (1 + c.slippage);
const slipDown = (p: number, c: CostModel) => p * (1 - c.slippage);

/** Exit engine shared by the strategy and the random-entry control. */
export function manageTrade(
  ltf: Candle[], atrArr: (number | null)[], signalIdx: number, side: 1 | -1,
  atrAtSignal: number, cfg: BacktestConfig
): Trade | null {
  const n = ltf.length;
  const entryIdx = signalIdx + 1;
  if (entryIdx >= n) return null;
  const { params: p, costs: c } = cfg;
  const rawOpen = ltf[entryIdx].open;
  const entry = side === 1 ? slipUp(rawOpen, c) : slipDown(rawOpen, c);
  let stop = entry - side * p.stopAtr * atrAtSignal;
  const initialStop = stop;
  const riskPrice = Math.abs(entry - initialStop);
  if (!(riskPrice > 0)) return null;

  let extreme = entry;
  let exitRaw = 0;
  let exitIdx = -1;
  let reason: "STOP" | "TIME" = "TIME";
  const last = Math.min(n - 1, entryIdx + p.maxBars - 1);

  for (let j = entryIdx; j <= last; j++) {
    const b = ltf[j];
    // 1) stop check against the stop known BEFORE this bar
    if (side === 1) {
      if (b.open <= stop) { exitRaw = b.open; exitIdx = j; reason = "STOP"; break; }
      if (b.low <= stop) { exitRaw = stop; exitIdx = j; reason = "STOP"; break; }
    } else {
      if (b.open >= stop) { exitRaw = b.open; exitIdx = j; reason = "STOP"; break; }
      if (b.high >= stop) { exitRaw = stop; exitIdx = j; reason = "STOP"; break; }
    }
    // 2) ratchet the trailing stop with this (now closed) bar; applies from the next bar
    extreme = side === 1 ? Math.max(extreme, b.high) : Math.min(extreme, b.low);
    const a = atrArr[j];
    if (a !== null) {
      const cand = side === 1 ? extreme - p.trailAtr * a : extreme + p.trailAtr * a;
      stop = side === 1 ? Math.max(stop, cand) : Math.min(stop, cand);
    }
  }
  if (exitIdx < 0) {
    exitIdx = last;
    exitRaw = ltf[last].close;
    reason = "TIME";
  }
  const exit = side === 1 ? slipDown(exitRaw, c) : slipUp(exitRaw, c);
  const bars = exitIdx - entryIdx + 1;
  const grossPnl = side * (exit - entry);
  const costs = feesPrice(entry, exit, c, !!cfg.entryMaker) + fundingPrice(side, entry, bars, c);
  return {
    side, entryIdx, exitIdx, entryTime: ltf[entryIdx].time, exitTime: ltf[exitIdx].time,
    entry, exit, initialStop, riskPrice, grossR: grossPnl / riskPrice,
    netR: (grossPnl - costs) / riskPrice, bars, reason,
  };
}

/** Strategy backtest: decisions from the shared trend core, LONG and SHORT. */
export function runTrend(ltf: Candle[], htf: Candle[], cfg: BacktestConfig): Trade[] {
  const ctx = prepareTrend(ltf, htf, cfg.params, cfg.ltfSec, cfg.htfSec);
  const trades: Trade[] = [];
  let i = cfg.params.donchian + cfg.params.atrPeriod;
  while (i < ltf.length - 1) {
    const sig = trendSignalAt(ctx, i, cfg.params);
    if (sig.side === 0 || sig.atr === null) { i++; continue; }
    const t = manageTrade(ltf, ctx.atr, i, sig.side, sig.atr, cfg);
    if (!t) break;
    trades.push(t);
    i = t.exitIdx + 1; // flat after exit; decide again on the following bar's close
  }
  return trades;
}

/**
 * Random-entry control: same exit engine and stop distance, same expected trade
 * frequency as the strategy, random side. Any real edge must beat this distribution.
 */
export function runRandomControl(
  ltf: Candle[], cfg: BacktestConfig, entryRate: number, seed: number
): Trade[] {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const atrArr = atrSeries(ltf, cfg.params.atrPeriod);
  const trades: Trade[] = [];
  let i = cfg.params.donchian + cfg.params.atrPeriod;
  while (i < ltf.length - 1) {
    const a = atrArr[i];
    if (a !== null && rnd() < entryRate) {
      const side: 1 | -1 = rnd() < 0.5 ? 1 : -1;
      const t = manageTrade(ltf, atrArr, i, side, a, cfg);
      if (!t) break;
      trades.push(t);
      i = t.exitIdx + 1;
      continue;
    }
    i++;
  }
  return trades;
}

/* ---------------- reporting (R-based; hit rate deliberately NOT reported) ---------------- */

export interface Report {
  trades: number;
  expectancyR: number;        // mean net R per trade
  profitFactor: number;       // sum(+R) / sum(|-R|), net
  maxDrawdownPct: number;     // on a fixed-fractional equity curve
  totalReturnPct: number;
  avgBars: number;
  longExpectancyR: number | null;
  shortExpectancyR: number | null;
  grossExpectancyR: number;   // before fees and funding (diagnostic)
  netR: number[];             // raw series, for statistics
}

export function report(trades: Trade[], riskPct = 0.01): Report {
  const R = trades.map((t) => t.netR);
  const n = R.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const gw = R.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const gl = -R.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  let eq = 1, peak = 1, mdd = 0;
  for (const r of R) {
    eq *= 1 + riskPct * r;
    peak = Math.max(peak, eq);
    mdd = Math.max(mdd, (peak - eq) / peak);
  }
  const longs = trades.filter((t) => t.side === 1).map((t) => t.netR);
  const shorts = trades.filter((t) => t.side === -1).map((t) => t.netR);
  return {
    trades: n,
    expectancyR: +mean(R).toFixed(4),
    profitFactor: +(gw / (gl || 1e-12)).toFixed(3),
    maxDrawdownPct: +(100 * mdd).toFixed(2),
    totalReturnPct: +(100 * (eq - 1)).toFixed(2),
    avgBars: +mean(trades.map((t) => t.bars)).toFixed(1),
    longExpectancyR: longs.length ? +mean(longs).toFixed(4) : null,
    shortExpectancyR: shorts.length ? +mean(shorts).toFixed(4) : null,
    grossExpectancyR: +mean(trades.map((t) => t.grossR)).toFixed(4),
    netR: R,
  };
}

export type { TrendContext };
