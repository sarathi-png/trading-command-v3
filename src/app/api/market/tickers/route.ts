import { knownSymbols, getTickers, MarketError, activeDataSource } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = url.searchParams.get("symbols")?.split(",").filter(Boolean);
  try {
    const tickers = await getTickers(symbols);
    return Response.json({ tickers, source: await activeDataSource(), known: knownSymbols() });
  } catch (e) {
    const msg = e instanceof MarketError ? e.message : "Market data unavailable";
    return Response.json({ error: msg, tickers: [], source: await activeDataSource(), known: knownSymbols() }, { status: 502 });
  }
}
