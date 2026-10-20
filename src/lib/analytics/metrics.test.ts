import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAnalytics, type AnalyticsTrade } from "./metrics";

const trade = (pnl: number, day: number, strategy = "paper"): AnalyticsTrade => ({
  symbol: "BTCUSD", direction: pnl >= 0 ? "long" : "short", strategy, pnl,
  openedAt: Date.UTC(2026, 0, day, 10), closedAt: Date.UTC(2026, 0, day, 11), exit: 100,
});

describe("analytics metrics", () => {
  it("computes wins, losses, profit factor and expectancy", () => {
    const m = computeAnalytics([trade(10, 1), trade(-5, 2), trade(20, 3), trade(0, 4)]);
    assert.equal(m.totalTrades, 4);
    assert.equal(m.wins, 2);
    assert.equal(m.losses, 2);
    assert.equal(m.net, 25);
    assert.equal(m.grossWin, 30);
    assert.equal(m.grossLoss, 5);
    assert.equal(m.profitFactor, 6);
    assert.equal(m.expectancy, 6.25);
    assert.equal(m.winRate, 50);
  });

  it("orders the equity curve by close time and groups by day and strategy", () => {
    const m = computeAnalytics([trade(10, 2, "a"), trade(-5, 1, "b"), trade(3, 2, "a")]);
    assert.deepEqual(m.equity, [-5, 5, 8]);
    assert.deepEqual(m.daily, [{ day: "2026-01-01", pnl: -5 }, { day: "2026-01-02", pnl: 13 }]);
    assert.deepEqual(m.byStrategy.map((s) => [s.strategy, s.trades, s.pnl]), [["a", 2, 13], ["b", 1, -5]]);
    assert.equal(m.avgDurationMs, 60 * 60 * 1000);
  });

  it("reports a zero profit factor for a loss-only sample, null only when there are no losses", () => {
    const losing = computeAnalytics([trade(-1, 1)]);
    assert.equal(losing.profitFactor, 0);
    assert.equal(losing.net, -1);
    const winning = computeAnalytics([trade(1, 1)]);
    assert.equal(winning.profitFactor, null);
  });
});
