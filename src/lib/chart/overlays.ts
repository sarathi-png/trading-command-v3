/**
 * Pure chart-overlay builders.
 *
 * The chart component owns lightweight-charts objects; this module owns the
 * numbers. Keeping the transformation pure means the marker/line logic is
 * testable without a browser canvas and cannot silently diverge from the shared
 * indicator module.
 */
import type { Candle, JournalEntry } from "@/lib/types";
import { closes, ema } from "../indicators";
import type { BacktestTrade } from "@/lib/strategy/v2/types";

export interface LinePoint {
  time: number; // unix seconds, matching Candle.time
  value: number;
}

export interface TradeMarker {
  time: number; // unix seconds
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text: string;
  size?: number;
}

/** EMA line data for one period, with warmup omitted. */
export function emaLine(candles: Candle[], period: number): LinePoint[] {
  const values = ema(closes(candles), period);
  const out: LinePoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    const value = values[i];
    if (value !== null && Number.isFinite(value)) out.push({ time: candles[i].time, value });
  }
  return out;
}

function seconds(ms: number | null | undefined): number | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

/**
 * Entry/exit markers for recorded journal trades. Open trades get an entry
 * marker only; a missing exit is never drawn at an invented price.
 */
export function journalTradeMarkers(
  entries: readonly JournalEntry[],
  symbol: string
): TradeMarker[] {
  const wanted = symbol.toUpperCase();
  const out: TradeMarker[] = [];
  for (const entry of entries) {
    if (entry.symbol.toUpperCase() !== wanted) continue;
    const long = entry.direction === "long";
    const entryTime = seconds(entry.openedAt);
    if (entryTime !== null) {
      out.push({
        time: entryTime,
        position: long ? "belowBar" : "aboveBar",
        color: "#57E6D2",
        shape: long ? "arrowUp" : "arrowDown",
        text: `J-${entry.mode === "paper" ? "P" : entry.mode === "live" ? "L" : "D"}`,
        size: 0.8,
      });
    }
    const exitTime = seconds(entry.closedAt);
    if (exitTime !== null && Number.isFinite(entry.pnl)) {
      out.push({
        time: exitTime,
        position: entry.pnl >= 0 ? "aboveBar" : "belowBar",
        color: entry.pnl >= 0 ? "#2FD388" : "#F0524F",
        shape: "square",
        text: "J-X",
        size: 0.7,
      });
    }
  }
  return out;
}

/** Backtest entry/exit markers, tagged so they cannot be mistaken for trades. */
export function backtestTradeMarkers(trades: readonly BacktestTrade[]): TradeMarker[] {
  const out: TradeMarker[] = [];
  for (const trade of trades) {
    if (Number.isFinite(trade.entryTime)) {
      out.push({
        time: Math.floor(trade.entryTime),
        position: trade.side === "long" ? "belowBar" : "aboveBar",
        color: "#F5B84D",
        shape: trade.side === "long" ? "arrowUp" : "arrowDown",
        text: "BT-IN",
        size: 0.6,
      });
    }
    if (Number.isFinite(trade.exitTime)) {
      out.push({
        time: Math.floor(trade.exitTime),
        position: trade.pnl >= 0 ? "aboveBar" : "belowBar",
        color: trade.pnl >= 0 ? "rgba(47,211,136,0.8)" : "rgba(240,82,79,0.8)",
        shape: "circle",
        text: "BT-OUT",
        size: 0.55,
      });
    }
  }
  return out;
}
