/**
 * AI-assisted strategy research.
 *
 * POST /api/research  — run one research request against the
 *                        configured AI provider and persist it.
 * GET  /api/research  — list past runs (optionally by symbol).
 *
 * Guarded by the API auth choke point (src/proxy.ts) like every
 * other route. The model is asked for ONE validated JSON object;
 * its answer is untrusted input and is never executed.
 */
import { NextRequest, NextResponse } from "next/server";
import { rateLimited } from "@/lib/rateLimit";
import { listResearchRuns, runResearch } from "@/lib/research/service";
import {
  cleanObjective,
  isResearchStrategyType,
  isSupportedResearchSymbol,
  isSupportedTimeframe,
} from "@/lib/research/validate";
import { knownSymbols } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** One research call spends real (free-tier) provider quota. */
const RESEARCH_RATE_LIMIT = 10; // requests
const RESEARCH_RATE_WINDOW_MS = 60_000; // per minute, per instance

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 500);
  const runs = await listResearchRuns({ symbol: symbol || undefined, limit });
  return NextResponse.json({ runs });
}

export async function POST(req: NextRequest) {
  // The operator is single-user, but a runaway client loop still
  // must not burn provider quota.
  const client = req.headers.get("x-forwarded-for") ?? "local";
  if (rateLimited(`research:${client}`, RESEARCH_RATE_LIMIT, RESEARCH_RATE_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many research requests. Wait a minute before retrying." }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = String(body.symbol ?? "").trim().toUpperCase();
  const timeframe = String(body.timeframe ?? "");
  const strategyType = String(body.strategyType ?? "");
  const objective = cleanObjective(body.objective);
  const constraints = typeof body.constraints === "string" ? body.constraints.slice(0, 1000) : "";
  const provider = typeof body.provider === "string" ? body.provider : "auto";
  const revisionOf = typeof body.revisionOf === "string" && body.revisionOf ? body.revisionOf : null;

  // Fail fast on invalid input, before any provider quota is spent.
  if (!isSupportedResearchSymbol(symbol, knownSymbols())) {
    return NextResponse.json({ error: `Unsupported symbol "${symbol}".` }, { status: 400 });
  }
  if (!isSupportedTimeframe(timeframe)) {
    return NextResponse.json({ error: `Unsupported timeframe "${timeframe}".` }, { status: 400 });
  }
  if (!isResearchStrategyType(strategyType)) {
    return NextResponse.json({ error: `Unsupported strategy type "${strategyType}".` }, { status: 400 });
  }
  if (objective === null) {
    return NextResponse.json(
      { error: "Objective must be 10–2000 characters of plain English, with no code or embedded instructions." },
      { status: 400 }
    );
  }

  try {
    const outcome = await runResearch({
      symbol,
      timeframe,
      strategyType: strategyType as "chandelier-donchian",
      objective,
      constraints,
      provider,
      revisionOf,
    });
    if (outcome.ok) {
      return NextResponse.json({ run: outcome.run, issues: outcome.issues });
    }
    // The run is persisted with status="failed" so the operator's
    // input is preserved and can be revised. Returned as 200 with an
    // error field: the run itself was created successfully.
    return NextResponse.json({ run: outcome.run, error: outcome.error });
  } catch (e) {
    // Never leak stack traces or internals.
    return NextResponse.json({ error: e instanceof Error ? e.message : "Research failed" }, { status: 502 });
  }
}
