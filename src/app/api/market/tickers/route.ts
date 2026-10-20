import { knownSymbols, getTickerEnvelope, MarketError, activeDataSource } from "@/lib/market/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = url.searchParams.get("symbols")?.split(",").filter(Boolean);
  try {
    const env = await getTickerEnvelope(symbols);
    return Response.json({
      tickers: env.data,
      source: env.source,
      provider: env.provider,
      asOf: env.asOf ? new Date(env.asOf).toISOString() : null,
      stale: env.stale,
      known: knownSymbols(),
    });
  } catch (e) {
    const msg = e instanceof MarketError ? e.message : "Market data unavailable";
    return Response.json({ error: msg, tickers: [], source: await activeDataSource(), known: knownSymbols() }, { status: 502 });
  }
}
