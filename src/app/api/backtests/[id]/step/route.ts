/**
 * POST /api/backtests/[id]/step — advance a walk-forward job
 * by ONE fold. Plain (single-segment) jobs have nothing to
 * step and report that directly.
 *
 * Guarded by src/proxy.ts. Each step is a bounded, resumable
 * unit of work; the job row is the source of truth, so a
 * retried or duplicated step is safe.
 */
import { NextRequest, NextResponse } from "next/server";
import { rateLimited } from "@/lib/rateLimit";
import { stepBacktestJob } from "@/lib/research/backtestService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const client = req.headers.get("x-forwarded-for") ?? "local";
  if (rateLimited(`backtest-step:${client}`, 60, 60_000)) {
    return NextResponse.json({ error: "Too many step requests." }, { status: 429 });
  }

  const { id } = await params;
  try {
    const outcome = await stepBacktestJob(id);
    if (outcome.ok) {
      return NextResponse.json({ job: outcome.job, deduplicated: outcome.deduplicated });
    }
    if (outcome.job === null) {
      return NextResponse.json({ error: outcome.error }, { status: 404 });
    }
    return NextResponse.json({ job: outcome.job, error: outcome.error }, { status: 422 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Backtest step failed" }, { status: 502 });
  }
}
