/**
 * GET  /api/research/[id] — fetch one research run.
 * PATCH /api/research/[id] — revise: re-run research from the
 *                            stored objective (optionally edited),
 *                            producing a NEW run linked by
 *                            revisionOf. The original is never
 *                            overwritten, so results can be
 *                            compared.
 */
import { NextRequest, NextResponse } from "next/server";
import { getResearchRun, runResearch } from "@/lib/research/service";
import { cleanObjective } from "@/lib/research/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getResearchRun(id);
  if (!run) return NextResponse.json({ error: "Research run not found." }, { status: 404 });
  return NextResponse.json({ run });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const original = await getResearchRun(id);
  if (!original) return NextResponse.json({ error: "Research run not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // A revision keeps the symbol/timeframe/strategy of the
  // original unless the operator explicitly changes them.
  const objective = cleanObjective(body.objective ?? original.objective);
  if (objective === null) {
    return NextResponse.json(
      { error: "Revised objective must be 10–2000 characters of plain English." },
      { status: 400 }
    );
  }

  try {
    const outcome = await runResearch({
      symbol: original.symbol,
      timeframe: original.timeframe,
      strategyType: original.strategyType,
      objective,
      constraints: typeof body.constraints === "string" ? body.constraints.slice(0, 1000) : original.constraints,
      provider: "auto",
      revisionOf: original.id,
    });
    if (outcome.ok) {
      return NextResponse.json({ run: outcome.run, issues: outcome.issues });
    }
    return NextResponse.json({ run: outcome.run, error: outcome.error });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Research revision failed" }, { status: 502 });
  }
}
