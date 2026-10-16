/**
 * AI signal prediction.
 *
 * GET  /api/ai            — provider status, free-tier budget, scoreboard and recent calls
 * POST /api/ai            — ask for a prediction for one chart
 *
 * Protected by the API auth choke point (src/proxy.ts) like every other route:
 * it spends the operator's own free-tier quota, so it is not public. Writing a
 * key additionally carries its own check in /api/ai/keys.
 */
import { aiPerformance, predict } from "@/lib/ai/service";
import { isAiChartType, isAiProviderId } from "@/lib/ai/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "25", 10) || 25, 100);
  try {
    const data = await aiPerformance(limit);
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "AI status unavailable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  let body: { symbol?: string; timeframe?: string; chartType?: string; provider?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = (body.symbol || "BTCUSD").toUpperCase();
  const timeframe = body.timeframe || "5m";
  const chartType = body.chartType ?? "candles";
  const provider = body.provider ?? "auto";

  if (!isAiChartType(chartType)) {
    return Response.json({ error: `Unsupported chart type: ${chartType}` }, { status: 400 });
  }
  if (!isAiProviderId(provider) && provider !== "auto") {
    return Response.json({ error: `Unsupported provider: ${provider}` }, { status: 400 });
  }

  try {
    const result = await predict({
      symbol,
      timeframe,
      chartType,
      provider: provider as "auto" | "openrouter" | "nvidia" | "rules",
      force: body.force === true,
    });
    if (result.error) return Response.json(result, { status: 422 });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Prediction failed" }, { status: 502 });
  }
}
