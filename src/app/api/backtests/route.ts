/**
 * Backtest jobs.
 *
 * POST /api/backtests — validate, persist and run a backtest.
 *                        A plain run completes synchronously
 *                        (bounded workload); a walk-forward run
 *                        returns a job to step through.
 * GET  /api/backtests  — list past jobs (optionally by symbol).
 *
 * Guarded by src/proxy.ts. Configurations are validated against
 * the engine's own allowlists before anything runs.
 */
import { NextRequest, NextResponse } from "next/server";
import { rateLimited } from "@/lib/rateLimit";
import {
  createBacktestJob,
  listBacktestJobs,
  validateBacktestParams,
  MAX_CANDLES,
  MIN_CANDLES,
} from "@/lib/research/backtestService";
import {
  DEFAULT_CHANDELIER_DONCHIAN_CONFIG,
  validateStrategyConfig,
  type ChandelierDonchianConfig,
} from "@/lib/strategy/v2/types";
import { requestWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKTEST_RATE_LIMIT = 30;
const BACKTEST_RATE_WINDOW_MS = 60_000;

/** Parse + strictly validate an inbound strategy config. */
function parseConfig(raw: unknown): ChandelierDonchianConfig {
  if (!raw || typeof raw !== "object") return DEFAULT_CHANDELIER_DONCHIAN_CONFIG;
  // Rebuild field-by-field so unknown keys from the client are
  // dropped rather than merged into the engine's config.
  const c = raw as Partial<ChandelierDonchianConfig>;
  const config: ChandelierDonchianConfig = {
    chandelier: {
      atrLength: Number(c.chandelier?.atrLength ?? DEFAULT_CHANDELIER_DONCHIAN_CONFIG.chandelier.atrLength),
      multiplier: Number(c.chandelier?.multiplier ?? DEFAULT_CHANDELIER_DONCHIAN_CONFIG.chandelier.multiplier),
    },
    donchian: {
      periods: Array.isArray(c.donchian?.periods)
        ? c.donchian!.periods.map(Number).filter((n) => Number.isFinite(n))
        : DEFAULT_CHANDELIER_DONCHIAN_CONFIG.donchian.periods,
    },
    heikinAshi: c.heikinAshi === true,
    timeStop: {
      enabled: c.timeStop?.enabled === true,
      bars: Number(c.timeStop?.bars ?? DEFAULT_CHANDELIER_DONCHIAN_CONFIG.timeStop.bars),
    },
    risk: {
      leverage: Number(c.risk?.leverage ?? DEFAULT_CHANDELIER_DONCHIAN_CONFIG.risk.leverage),
      riskPct: Number(c.risk?.riskPct ?? DEFAULT_CHANDELIER_DONCHIAN_CONFIG.risk.riskPct),
      lotSize: typeof c.risk?.lotSize === "number" ? c.risk!.lotSize : null,
      maxPositions: Number(c.risk?.maxPositions ?? DEFAULT_CHANDELIER_DONCHIAN_CONFIG.risk.maxPositions),
      mode: c.risk?.mode === "manual" ? "manual" : "auto",
    },
  };
  validateStrategyConfig(config); // throws on any out-of-range value
  return config;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 500);
  const jobs = await listBacktestJobs({ symbol: symbol || undefined, limit });
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  const client = req.headers.get("x-forwarded-for") ?? "local";
  if (rateLimited(`backtest:${client}`, BACKTEST_RATE_LIMIT, BACKTEST_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many backtest requests. Wait a minute before retrying." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const timeframe = String(body.timeframe ?? "");
  const workspace = (await requestWorkspace()) ?? "paper";

  let config: ChandelierDonchianConfig;
  try {
    config = parseConfig(body.config);
  } catch {
    return NextResponse.json({ error: "The strategy configuration is invalid." }, { status: 400 });
  }

  const params = {
    symbol,
    timeframe,
    config,
    capital: Number(body.capital ?? 10000),
    feeRate: Number(body.feeRate ?? 0.0005),
    slippage: Number(body.slippage ?? 0.0001),
    candleLimit: Math.min(Number(body.candleLimit ?? 300) || 300, MAX_CANDLES),
    walkForward: body.walkForward === true,
    trainWindow: Math.round(Number(body.trainWindow ?? 300)) || 300,
    testWindow: Math.round(Number(body.testWindow ?? 100)) || 100,
    researchRunId: typeof body.researchRunId === "string" && body.researchRunId ? body.researchRunId : null,
    workspace,
    idempotencyKey: typeof body.idempotencyKey === "string" && body.idempotencyKey ? body.idempotencyKey : undefined,
  };

  // Bound the candle count to the allowed range before running.
  params.candleLimit = Math.max(MIN_CANDLES, Math.min(params.candleLimit, MAX_CANDLES));

  try {
    validateBacktestParams(params);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invalid backtest parameters" }, { status: 400 });
  }

  try {
    const outcome = await createBacktestJob(params);
    if (outcome.ok) {
      return NextResponse.json({ job: outcome.job, deduplicated: outcome.deduplicated });
    }
    // A failed job is persisted (auditable) and reported as 422.
    return NextResponse.json({ job: outcome.job, error: outcome.error }, { status: 422 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Backtest failed" }, { status: 502 });
  }
}
