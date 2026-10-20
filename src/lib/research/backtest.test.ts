/**
 * Tests for the extended backtesting engine and the walk-forward
 * job workflow. Deterministic: the candle source is injected, so
 * no test touches the network.
 */
import "./testSetup";
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { invalidateAll } from "@/lib/fileStore";
import { fileRepo } from "@/lib/repo/file";
import type { Candle } from "@/lib/types";
import { demoCandles } from "../market/demo";
import {
  runBacktest,
  runWalkForward,
  aggregateWalkForward,
  sanitizeCandles,
  DEFAULT_BACKTEST_CONFIG,
} from "../strategy/v2/backtest";
import {
  validateStrategyConfig,
  DEFAULT_CHANDELIER_DONCHIAN_CONFIG,
} from "../strategy/v2/types";
import {
  createBacktestJob,
  stepBacktestJob,
  foldPlan,
  MIN_CANDLES,
} from "./backtestService";

/* ---------------- fixtures ---------------- */

/**
 * Deterministic demo-simulator candles (a pure function of time),
 * which exercise the real signal logic — unlike a hand-rolled
 * series, these actually produce breakouts, stops and flips.
 */
function fixtureCandles(count = 600): Candle[] {
  return demoCandles("BTCUSD", "15m", count);
}

const CONFIG = DEFAULT_CHANDELIER_DONCHIAN_CONFIG;

/* ---------------- engine metrics ---------------- */

describe("backtest engine metrics", () => {
  const candles = fixtureCandles();
  const result = runBacktest(candles, CONFIG, DEFAULT_BACKTEST_CONFIG);

  it("runs a real backtest and reports a full metric set", () => {
    assert.ok(result.totalTrades >= 0);
    assert.ok(Number.isFinite(result.netProfit));
    assert.ok(Number.isFinite(result.netReturnPct));
    assert.ok(Number.isFinite(result.grossProfit));
    assert.ok(result.grossProfit >= 0);
    assert.ok(Number.isFinite(result.grossLoss));
    assert.ok(result.grossLoss >= 0);
    assert.ok(result.winRate >= 0 && result.winRate <= 100);
    assert.ok(Array.isArray(result.equityCurve));
    assert.ok(Array.isArray(result.trades));
    assert.ok(Array.isArray(result.dataWarnings));
  });

  it("stamps the engine version and states the fill model", () => {
    assert.equal(result.configVersion, "chandelier-donchian-backtest-v1");
    assert.match(result.fillModel, /closed-bar/i);
  });

  it("keeps the accounting identity: net P&L = ending - initial equity", () => {
    assert.ok(Math.abs((result.endingEquity - result.initialCapital) - result.netProfit) < 0.01);
    assert.ok(Math.abs(result.netReturnPct - (result.netProfit / result.initialCapital * 100)) < 0.01);
  });

  it("reconciles trade counts and gross figures", () => {
    const { trades } = result;
    const winners = trades.filter((t) => t.pnl > 0);
    const losers = trades.filter((t) => t.pnl < 0);
    assert.equal(result.winningTrades, winners.length);
    assert.equal(result.losingTrades, losers.length);
    assert.equal(result.totalTrades, trades.length);
    const gp = winners.reduce((s, t) => s + t.pnl, 0);
    const gl = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
    assert.ok(Math.abs(result.grossProfit - gp) < 0.01);
    assert.ok(Math.abs(result.grossLoss - gl) < 0.01);
    if (trades.length) {
      assert.ok(Math.abs(result.avgWin - (winners.length ? gp / winners.length : 0)) < 0.01);
      assert.ok(Math.abs(result.avgLoss - (losers.length ? gl / losers.length : 0)) < 0.01);
    }
  });

  it("charges fees and slippage, which only ever reduce net P&L", () => {
    const free = runBacktest(candles, CONFIG, { ...DEFAULT_BACKTEST_CONFIG, feeRate: 0, slippage: 0 });
    const costed = runBacktest(candles, CONFIG, { ...DEFAULT_BACKTEST_CONFIG, feeRate: 0.001, slippage: 0.001 });
    assert.ok(free.fees === 0 && free.slippageCost === 0);
    assert.ok(costed.fees > 0 && costed.slippageCost > 0);
    assert.ok(costed.netProfit <= free.netProfit + 1e-6);
  });

  it("produces a bounded, monotonic drawdown figure", () => {
    assert.ok(result.maxDrawdown >= 0);
    assert.ok(result.maxDrawdownPct >= 0 && result.maxDrawdownPct <= 100);
  });

  it("refuses an invalid config and invalid costs", () => {
    assert.throws(() => runBacktest(candles, { ...CONFIG, donchian: { periods: [] } } as never));
    assert.throws(() => runBacktest(candles, CONFIG, { ...DEFAULT_BACKTEST_CONFIG, initialCapital: -1 }));
  });
});

/* ---------------- no look-ahead ---------------- */

describe("no look-ahead bias", () => {
  it("ignores future candles when deciding past trades", () => {
    const base = fixtureCandles();
    const cutoff = base.at(-1)!.time;
    // Continue the series with fresh, LATER bars (same shape, new
    // monotonic timestamps) so "the future" is genuinely unseen.
    const step = 15 * 60; // 15m in seconds
    const extension = base.slice(-100).map((c, i) => ({ ...c, time: cutoff + (i + 1) * step }));
    const short = runBacktest(base, CONFIG, DEFAULT_BACKTEST_CONFIG);
    const extended = runBacktest([...base, ...extension], CONFIG, DEFAULT_BACKTEST_CONFIG);
    // Trades that closed strictly before the cut were decided by
    // identical data in both runs, so they must be byte-identical.
    const a = short.trades.filter((t) => t.exitTime < cutoff);
    const b = extended.trades.filter((t) => t.exitTime < cutoff);
    assert.deepEqual(a, b);
  });
});

/* ---------------- data hygiene ---------------- */

describe("data hygiene", () => {
  it("surfaces data-quality warnings on the result", () => {
    const good = fixtureCandles(200);
    const dirty = [...good, { ...good[1] }]; // duplicate timestamp
    const { candles: clean, warnings } = sanitizeCandles(dirty);
    assert.equal(clean.length, good.length);
    assert.ok(warnings.some((w) => /duplicate/i.test(w)));
    const result = runBacktest(clean, CONFIG, DEFAULT_BACKTEST_CONFIG, 0, warnings);
    assert.deepEqual(result.dataWarnings, warnings);
  });

  it("drops non-finite and impossible candles", () => {
    const good = fixtureCandles(10);
    const dirty = [
      ...good,
      { ...good[0], close: Number.NaN },
      { ...good[0], high: 1, low: 5 },
      { ...good[0], close: -3 },
    ];
    const { candles } = sanitizeCandles(dirty);
    assert.equal(candles.length, good.length);
  });
});

/* ---------------- walk-forward ---------------- */

describe("walk-forward / out-of-sample", () => {
  const candles = fixtureCandles(600);

  it("builds non-overlapping test windows", () => {
    const folds = foldPlan(600, 200, 100);
    assert.ok(folds.length >= 2);
    for (let i = 1; i < folds.length; i++) {
      // Each fold starts testWindow bars after the previous one,
      // so the [start+train, end] test windows never overlap.
      assert.ok(folds[i].start >= folds[i - 1].start + 100, "test windows must not overlap");
    }
    for (const f of folds) {
      assert.equal(f.end - f.start, 200 + 100); // train + test
    }
  });

  it("runs independent OOS segments and aggregates them honestly", () => {
    const segments = runWalkForward(candles, CONFIG, 200, 100, 100);
    assert.ok(segments.length >= 2);
    const agg = aggregateWalkForward(segments);
    // Trades are pooled; the curve is NOT fabricated by compounding.
    assert.equal(agg.totalTrades, segments.reduce((s, r) => s + r.totalTrades, 0));
    assert.deepEqual(agg.equityCurve, []);
    assert.ok(agg.dataWarnings.some((w) => /not compounded/i.test(w)));
    // Worst window drawdown is reported, not an average.
    assert.equal(agg.maxDrawdownPct, Math.max(...segments.map((r) => r.maxDrawdownPct)));
  });

  it("rejects overlapping or non-positive windows", () => {
    assert.throws(() => runWalkForward(candles, CONFIG, 100, 0));
    assert.throws(() => runWalkForward(candles, CONFIG, 100, 50, 25)); // step < test
  });
});

/* ---------------- job workflow (service, injected data) ---------------- */

describe("backtest job workflow", () => {
  before(() => { invalidateAll(); });

  const candles = fixtureCandles(500);
  const fetchCandles = async () => ({ candles, source: "demo" as const });
  const params = {
    symbol: "BTCUSD", timeframe: "15m", config: CONFIG,
    capital: 10000, feeRate: 0.0005, slippage: 0.0001, candleLimit: 500,
    walkForward: false,
  };

  it("creates and completes a plain backtest job", async () => {
    const outcome = await createBacktestJob({ ...params, idempotencyKey: "bt_ok_complete" }, { fetchCandles });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.job!.status, "completed");
    assert.equal(outcome.job!.segmentsTotal, 1);
    assert.equal(outcome.job!.segmentsDone, 1);
    assert.ok(outcome.job!.result);
    assert.equal(outcome.job!.result!.configVersion, "chandelier-donchian-backtest-v1");
    assert.match(outcome.job!.fillModel, /closed-bar/i);
    assert.ok(outcome.job!.dataWarnings.some((w) => /demo/i.test(w)));
  });

  it("deduplicates a retried job by idempotency key", async () => {
    const first = await createBacktestJob({ ...params, idempotencyKey: "bt_ok_dedup" }, { fetchCandles });
    const again = await createBacktestJob({ ...params, idempotencyKey: "bt_ok_dedup" }, { fetchCandles });
    assert.equal(again.ok, true);
    assert.equal(again.deduplicated, true);
    assert.equal(again.job!.id, first.job!.id);
  });

  it("fails (persisted) when history is insufficient", async () => {
    const few = fixtureCandles(MIN_CANDLES - 10);
    const outcome = await createBacktestJob({ ...params, idempotencyKey: "bt_ok_insufficient" }, {
      fetchCandles: async () => ({ candles: few, source: "demo" as const }),
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.job!.status, "failed");
    assert.match(outcome.error, /insufficient candle history/i);
  });

  it("rejects an invalid strategy config before any job is created", async () => {
    await assert.rejects(
      () => createBacktestJob({ ...params, config: { ...CONFIG, donchian: { periods: [] } } as never }, { fetchCandles }),
      /config/i
    );
  });

  it("rejects invalid job parameters", async () => {
    await assert.rejects(() => createBacktestJob({ ...params, symbol: "NOPE" }, { fetchCandles }));
    await assert.rejects(() => createBacktestJob({ ...params, capital: 0 }, { fetchCandles }));
  });

  it("steps a walk-forward job through every fold to completion", async () => {
    const wf = await createBacktestJob(
      { ...params, idempotencyKey: "bt_ok_wf", walkForward: true, trainWindow: 200, testWindow: 100 },
      { fetchCandles }
    );
    assert.equal(wf.ok, true);
    assert.equal(wf.job!.status, "running");
    assert.equal(wf.job!.segmentsDone, 1); // first fold runs inline
    assert.ok(wf.job!.segmentsTotal >= 2);

    let job = wf.job!;
    let guard = 0;
    while (job.status === "running" && guard++ < 50) {
      const stepped = await stepBacktestJob(job.id, { fetchCandles });
      assert.equal(stepped.ok, true);
      job = stepped.job!;
    }
    assert.equal(job.status, "completed");
    assert.equal(job.segmentsDone, job.segmentsTotal);
    assert.equal(job.segmentResults!.length, job.segmentsTotal);
    // Aggregated result pools trades and refuses to fake a compound curve.
    assert.equal(job.result!.totalTrades, job.segmentResults!.reduce((s, r) => s + r.totalTrades, 0));
    assert.deepEqual(job.result!.equityCurve, []);
  });

  it("is idempotent: stepping a completed job is a safe no-op", async () => {
    const plain = await createBacktestJob({ ...params, idempotencyKey: "bt_ok_noop" }, { fetchCandles });
    const stepped = await stepBacktestJob(plain.job!.id, { fetchCandles });
    // A completed job is returned as-is rather than re-run.
    assert.equal(stepped.ok, true);
    assert.equal(stepped.deduplicated, true);
    assert.equal(stepped.job!.status, "completed");
  });

  it("refuses to step a plain (non-walk-forward) job", async () => {
    // A single-segment job that is somehow still running has no
    // pending fold to advance.
    const stuck = await fileRepo.insertBacktestJob({
      idempotencyKey: "bt_stuck_plain",
      workspace: "paper",
      symbol: "BTCUSD",
      timeframe: "15m",
      config: CONFIG,
      capital: 10000,
      feeRate: 0.0005,
      slippage: 0.0001,
      candleLimit: 500,
      walkForward: false,
      trainWindow: null,
      testWindow: null,
      status: "running",
      segmentsTotal: 1,
      segmentsDone: 0,
      result: null,
      segmentResults: null,
      dataWarnings: [],
      fillModel: "closed-bar",
      researchRunId: null,
      error: null,
    });
    const stepped = await stepBacktestJob(stuck.id, { fetchCandles });
    assert.equal(stepped.ok, false);
    assert.match(stepped.error, /no pending segments/i);
  });

  it("rejects an unknown job id", async () => {
    const outcome = await stepBacktestJob("bt_missing", { fetchCandles });
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /not found/i);
  });
});

/* ---------------- config validation is shared ---------------- */

describe("strategy config validation", () => {
  it("validates the default config", () => {
    assert.doesNotThrow(() => validateStrategyConfig(CONFIG));
  });
});
