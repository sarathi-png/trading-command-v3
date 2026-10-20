import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backtestTradeMarkers, emaLine, journalTradeMarkers } from "./overlays";
import type { Candle, JournalEntry } from "@/lib/types";

const candle = (i: number, close: number): Candle => ({
  time: 1_700_000_000 + i * 60, open: close, high: close + 1, low: close - 1, close, volume: 1,
});

function journal(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    mode: "paper", symbol: "BTCUSD", direction: "long", entry: 100, exit: 110,
    qty: 1, fees: 0, pnl: 10, strategy: "paper", reason: "", notes: "", emotion: "",
    tags: [], openedAt: 1_700_000_000_000, closedAt: 1_700_000_060_000, source: "paper",
    ...overrides,
  };
}

describe("chart overlays", () => {
  it("EMA overlay omits warmup and keeps bar timestamps", () => {
    const candles = [100, 101, 102, 103, 104].map((v, i) => candle(i, v));
    const line = emaLine(candles, 3);
    assert.equal(line.length, 3, "first two bars are warmup");
    assert.deepEqual(line.map((p) => p.time), candles.slice(2).map((c) => c.time));
    for (const point of line) assert.ok(Number.isFinite(point.value));
  });

  it("journal markers are symbol-scoped and never invent a missing exit", () => {
    const entries = [
      journal({}),
      journal({ symbol: "ETHUSD" }),
      journal({ closedAt: null, pnl: 0 }),
    ];
    const markers = journalTradeMarkers(entries, "btcusd");
    assert.equal(markers.filter((m) => m.text === "J-P").length, 2);
    assert.equal(markers.filter((m) => m.text === "J-X").length, 1);
    assert.equal(markers[0].time, 1_700_000_000);
  });

  it("backtest markers are labelled separately from journal trades", () => {
    const markers = backtestTradeMarkers([
      { entryTime: 1_700_000_000, exitTime: 1_700_000_300, entryPrice: 100, exitPrice: 105, side: "long", qty: 1, pnl: 5, pnlPct: 5, exitReason: "target", barsHeld: 5 },
    ]);
    assert.deepEqual(markers.map((m) => m.text), ["BT-IN", "BT-OUT"]);
    assert.ok(markers.every((m) => m.time >= 1_700_000_000));
  });
});
