import { getOrderbook, getRecentTrades } from "@/lib/market/service";
import { flags } from "@/lib/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: Request) {
  if (!flags.orderbook()) {
    return Response.json({ error: "Order book module disabled", orderbook: null });
  }
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "BTCUSD").toUpperCase();
  try {
    const [orderbook, trades] = await Promise.all([getOrderbook(symbol), getRecentTrades(symbol)]);
    return Response.json({ orderbook, trades });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Order book unavailable" },
      { status: 502 }
    );
  }
}
