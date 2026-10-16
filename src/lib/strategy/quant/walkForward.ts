/**
 * Walk-forward simulator — port of trader_bot_v2/backtest/walk_forward.py.
 * Entry next-bar open, stop-first intrabar, one position at a time,
 * time-stop 48 bars, costs 0.059% fee + 0.02% slippage per side.
 */
import type { Candle } from "@/lib/types";
import { analyzeConfluence } from "./confluence";

export interface SimTrade {
  side: "LONG" | "SHORT"; entry: number; exit: number;
  score: number; reason: string; pnlPct: number;
}

const FEE = 0.059 / 100, SLIP = 0.02 / 100;

export function simulate(ltf: Candle[], warmup = 120, maxHold = 48): SimTrade[] {
  const trades: SimTrade[] = [];
  let i = warmup;
  while (i < ltf.length - 1) {
    const win = ltf.slice(Math.max(0, i - 199), i + 1);
    const htfProxy = ltf.slice(Math.max(0, i - 199), i + 1);
    const rep = analyzeConfluence(win, htfProxy);
    if (rep.direction === "NEUTRAL" || rep.score < 55) { i++; continue; }
    const entry = ltf[i + 1].open * (rep.direction === "LONG" ? 1 + SLIP : 1 - SLIP);
    const atrV = rep.atr ?? (entry * 0.003);
    const sl = rep.direction === "LONG" ? entry - 1.5 * atrV : entry + 1.5 * atrV;
    const tp = rep.direction === "LONG"
      ? entry + 2 * (entry - sl) : entry - 2 * (sl - entry);
    let exit = ltf[Math.min(ltf.length - 1, i + maxHold)].close;
    let reason = "TIME_STOP";
    const end = Math.min(ltf.length - 1, i + maxHold);
    for (let j = i + 1; j <= end; j++) {
      const hitSL = rep.direction === "LONG" ? ltf[j].low <= sl : ltf[j].high >= sl;
      const hitTP = rep.direction === "LONG" ? ltf[j].high >= tp : ltf[j].low <= tp;
      if (hitSL && hitTP) { // stop-first worst case
        exit = sl * (rep.direction === "LONG" ? 1 - SLIP : 1 + SLIP); reason = "STOP_LOSS"; break;
      }
      if (hitSL) { exit = sl * (rep.direction === "LONG" ? 1 - SLIP : 1 + SLIP); reason = "STOP_LOSS"; break; }
      if (hitTP) { exit = tp * (rep.direction === "LONG" ? 1 - SLIP : 1 + SLIP); reason = "TAKE_PROFIT"; break; }
    }
    const gross = rep.direction === "LONG" ? (exit - entry) / entry : (entry - exit) / entry;
    const pnlPct = (gross - 2 * (FEE + SLIP)) * 100;
    trades.push({ side: rep.direction, entry, exit, score: rep.score, reason, pnlPct });
    // resume after exit bar
    const exitIdx = ltf.findIndex((c, k) => k > i && (c.high >= tp || c.low <= sl));
    i = (exitIdx > i ? exitIdx : i) + 1;
  }
  return trades;
}

export function summarize(trades: SimTrade[]) {
  if (!trades.length) return { trades: 0, hitRate: null, avgPnl: null };
  const wins = trades.filter((t) => t.pnlPct > 0);
  return {
    trades: trades.length,
    hitRate: Math.round((wins.length / trades.length) * 1000) / 10,
    avgPnl: Math.round((trades.reduce((a, t) => a + t.pnlPct, 0) / trades.length) * 1000) / 1000,
  };
}
