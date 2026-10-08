/**
 * Exchange account summary for the dashboard panel.
 *
 * Replaces /api/delta/summary: the figures now come from CoinDCX (wallet,
 * trades, position transactions) through src/lib/exchangeAccount. Nothing is
 * credential-bearing in the response — balances, P&L and closed trades only.
 */
import { getExchangeSummary } from "@/lib/exchangeAccount";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const windowDays = Number(new URL(req.url).searchParams.get("windowDays") ?? "") || undefined;
  try {
    const summary = await getExchangeSummary(windowDays ? { windowDays } : {});
    return Response.json(summary);
  } catch (e) {
    // getExchangeSummary already degrades instead of throwing; this is the last
    // resort so the panel renders an error rather than a blank card.
    return Response.json(
      { available: false, error: e instanceof Error ? e.message : "Exchange summary unavailable" },
      { status: 200 }
    );
  }
}
