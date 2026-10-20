/**
 * POST /api/research/[id]/promote — explicit, gated handoff of a
 * validated research configuration into PAPER trading.
 *
 * Safeguards, in order:
 *   1. the run must be completed AND carry a validated executable
 *      config (a "research-only" hypothesis cannot be promoted);
 *   2. the active workspace must be PAPER — promotion from the
 *      LIVE workspace is refused outright, so research can never
 *      arm a live strategy;
 *   3. the config is re-validated by the engine's own validator
 *      before it is written;
 *   4. the write goes to the workspace-scoped strategy setting the
 *      existing paper engine already reads — no new execution path
 *      is created, and the existing risk evaluator still governs
 *      every order.
 *
 * This never places an order and never touches live execution.
 */
import { NextRequest, NextResponse } from "next/server";
import { requestWorkspace } from "@/lib/workspace";
import { getResearchRun } from "@/lib/research/service";
import { canPromoteToPaper } from "@/lib/research/service";
import { validateStrategyConfig } from "@/lib/strategy/v2/types";
import { updateSettings, logAudit } from "@/lib/settings";
import { flags } from "@/lib/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!flags.paperTrading()) {
    return NextResponse.json({ error: "Paper trading is disabled by configuration." }, { status: 403 });
  }

  const workspace = await requestWorkspace();
  if (workspace !== "paper") {
    return NextResponse.json(
      { error: "A research strategy can only be enabled in the Paper workspace. Live execution is never armed automatically." },
      { status: 403 }
    );
  }

  const { id } = await params;
  const run = await getResearchRun(id);
  if (!run) return NextResponse.json({ error: "Research run not found." }, { status: 404 });
  if (!canPromoteToPaper(run)) {
    return NextResponse.json(
      { error: "This research run has no validated executable configuration, so it cannot be enabled for paper trading." },
      { status: 422 }
    );
  }

  const config = run.report!.strategyConfig!;
  // Re-validate with the engine's own validator — the exact code
  // the paper engine will run — before writing anything.
  try {
    validateStrategyConfig(config);
  } catch {
    return NextResponse.json(
      { error: "The stored configuration no longer passes the engine's validation, so it was not enabled." },
      { status: 422 }
    );
  }

  // Write to the workspace-scoped strategy setting the existing
  // Chandelier + Donchian panel (and therefore the paper engine)
  // already consumes. The operator must still place orders by hand.
  const settings = await updateSettings({ chandelierDonchian: config });
  await logAudit("research_promoted_to_paper", {
    researchRunId: run.id,
    symbol: run.symbol,
    timeframe: run.timeframe,
    configVersion: "chandelier-donchian",
  });

  return NextResponse.json({
    ok: true,
    settings: { chandelierDonchian: settings.chandelierDonchian ?? null },
    message: "Strategy configuration enabled for PAPER trading. Place orders manually — no order was placed by this action.",
  });
}
