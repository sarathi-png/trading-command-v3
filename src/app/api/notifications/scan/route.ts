/** Scheduled handler and foreground monitor share the EXACT chart evaluation paths. */
import { GET as evaluateNormal } from "../../strategy/evaluate/route";
import { GET as evaluateHeikinAshi } from "../../strategy/chandelier-donchian/route";
import { deliveryConfig } from "@/lib/notifications/service";
import { getSettings } from "@/lib/settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
let running = false,
  lastRun = 0;
export async function GET() {
  const config = deliveryConfig();
  if (!config.enabled)
    return Response.json({ skipped: "Notifications disabled" });
  if (running || Date.now() - lastRun < 55_000)
    return Response.json({
      skipped: "Monitor already ran this minute or is running",
    });
  running = true;
  lastRun = Date.now();
  try {
    const settings = await getSettings();
    if (settings.dataSource === "demo" && !config.allowDemo)
      return Response.json({ skipped: "Demo notifications disabled" });
    const watchlist = [...new Set(settings.watchlist)].slice(0, 10);
    const results: {
      symbol: string;
      normal?: number;
      heikinAshi?: number;
      error?: string;
    }[] = [];
    for (const symbol of watchlist) {
      const result: (typeof results)[number] = { symbol };
      try {
        if (config.normal)
          result.normal = (
            await evaluateNormal(
              new Request(
                `http://internal.invalid/api/strategy/evaluate?symbol=${encodeURIComponent(symbol)}&timeframe=15m`,
              ),
            )
          ).status;
        if (config.heikinAshi)
          result.heikinAshi = (
            await evaluateHeikinAshi(
              new Request(
                `http://internal.invalid/api/strategy/chandelier-donchian?symbol=${encodeURIComponent(symbol)}&timeframe=5m&chartType=heikin-ashi`,
              ),
            )
          ).status;
      } catch {
        result.error = "Evaluation unavailable; no fabricated signal sent";
      }
      results.push(result);
    }
    return Response.json({
      evaluatedAt: Date.now(),
      results,
      scope: "First 10 watchlist symbols; normal 15m and Heikin-Ashi 5m",
    });
  } finally {
    running = false;
  }
}
export const POST = GET;
