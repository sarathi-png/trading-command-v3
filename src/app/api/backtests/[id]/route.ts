/**
 * GET /api/backtests/[id] — poll a backtest job's status,
 * progress and (once complete) its full results.
 *
 * Guarded by src/proxy.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { getBacktestJob } from "@/lib/research/backtestService";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await getBacktestJob(id);
  if (!job) return NextResponse.json({ error: "Backtest job not found." }, { status: 404 });
  return NextResponse.json({ job });
}
