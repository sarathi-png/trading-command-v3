import { moversReport } from "@/lib/market/moversService";
import { dispatchNotice } from "@/lib/notifications/service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  try {
    return Response.json(await moversReport());
  } catch {
    return Response.json(
      {
        error:
          "Market movers unavailable. No demo data was substituted for live data.",
      },
      { status: 502 },
    );
  }
}
export async function POST() {
  try {
    const report = await moversReport();
    const lines = [
      `24-hour movers; ${report.scope}`,
      ...[...report.gainers.slice(0, 10), ...report.losers.slice(0, 10)].map(
        (row) =>
          `${row.ticker.symbol} ${row.ticker.change24hPct > 0 ? "+" : ""}${row.ticker.change24hPct.toFixed(2)}%: ${row.assessment.stance}`,
      ),
    ];
    // A report is distinct from a qualified setup and never triggers execution.
    const results = await dispatchNotice({
      symbol: "MARKET MOVERS",
      timeframe: "5m",
      chart: "digest",
      strategy: "24-hour ranking + closed-candle assessment",
      direction: "REPORT",
      barTime: Math.floor(report.asOf / 300000) * 300000,
      source: report.source,
      entry: null,
      stop: null,
      target: null,
      reasons: [lines.join("\n")],
    });
    return Response.json({
      results,
      note: results.length
        ? "Snapshot submitted; inspect provider status in Settings."
        : "Nothing sent: notifications disabled, demo alerts disallowed, no configured channel, duplicate snapshot or daily cap.",
    });
  } catch {
    return Response.json(
      { error: "Report sharing unavailable" },
      { status: 502 },
    );
  }
}
