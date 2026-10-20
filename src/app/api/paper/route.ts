import { getRepo } from "@/lib/repo";
import { flags } from "@/lib/flags";
import { getTickers } from "@/lib/market/service";
import {
  attachBrackets, cancelPaperOrder, closePaperPosition,
  getPaperState, placePaperOrder, syncPaper,
} from "@/lib/paper/engine";
import { getSettings, logAudit } from "@/lib/settings";
import { isValidClientOrderId } from "@/lib/orderId";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function priceMap(symbols: string[]): Promise<Map<string, number>> {
  try {
    const tickers = await getTickers(symbols);
    return new Map(tickers.map((t) => [t.symbol, t.price]));
  } catch {
    return new Map();
  }
}

export async function GET() {
  const settings = await getSettings();
  if (!flags.paperTrading()) {
    return Response.json({ error: "Paper trading module disabled", positions: [], orders: [], events: [] });
  }
  // Gather prices for symbols that have positions or open orders.
  const pre = await getPaperState(new Map());
  const symbols = new Set<string>([
    ...pre.positions.map((p) => p.symbol),
    ...pre.orders.filter((o) => o.status === "open").map((o) => o.symbol),
    ...settings.watchlist,
  ]);
  const prices = await priceMap([...symbols]);
  const events = await syncPaper(prices);
  const state = await getPaperState(prices);
  return Response.json({ ...state, events, mode: settings.mode });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const action = String(body.action ?? "place");
  const settings = await getSettings();

  if (!flags.paperTrading()) {
    return Response.json({ error: "Paper trading is disabled by configuration" }, { status: 403 });
  }
  if (settings.mode === "read_only") {
    return Response.json(
      { error: "Execution is disabled. Switch to PAPER mode to simulate orders." },
      { status: 403 }
    );
  }
  if (settings.mode !== "paper") {
    return Response.json(
      { error: "Paper endpoint accepts orders only in PAPER mode." },
      { status: 403 }
    );
  }

  if (action === "close") {
    let positionId = String(body.positionId ?? "");
    const symbol = String(body.symbol ?? "");
    if (!positionId && symbol) {
      const p = await (await getRepo()).getPaperPositionBySymbol(symbol);
      if (p) positionId = p.id;
    }
    const prices = await priceMap([symbol]);
    const mark = prices.get(symbol);
    if (!mark) return Response.json({ error: "No price available for symbol" }, { status: 400 });
    const events = await closePaperPosition(positionId, mark);
    return Response.json({ ok: true, events });
  }

  if (action === "cancel") {
    const ok = await cancelPaperOrder(String(body.orderId ?? ""));
    return Response.json({ ok });
  }

  if (action === "brackets") {
    const ok = await attachBrackets(
      String(body.symbol ?? ""),
      typeof body.stop === "number" ? body.stop : null,
      typeof body.target === "number" ? body.target : null
    );
    return Response.json({ ok });
  }

  // action === "place"
  const clientOrderId = body.client_order_id;
  if (!isValidClientOrderId(clientOrderId)) {
    return Response.json(
      { error: "client_order_id (1-64 chars of [A-Za-z0-9._:-]) is required; it makes retries idempotent" },
      { status: 400 }
    );
  }
  // Strict enums: a caller asking for LIMIT must not silently get MARKET.
  if (body.side !== "buy" && body.side !== "sell") {
    return Response.json({ error: "side must be 'buy' or 'sell'" }, { status: 400 });
  }
  if (!["market", "limit", "stop_market", "stop_limit"].includes(String(body.type))) {
    return Response.json(
      { error: "type must be market, limit, stop_market or stop_limit" },
      { status: 400 }
    );
  }
  const side: "buy" | "sell" = body.side;
  const symbol = String(body.symbol ?? "").toUpperCase();
  const prices = await priceMap([symbol]);
  const mark = prices.get(symbol);
  if (!mark) return Response.json({ error: "No price available for symbol" }, { status: 400 });

  const result = await placePaperOrder(
    {
      symbol,
      side,
      type: body.type as "market" | "limit" | "stop_market" | "stop_limit",
      qty: Number(body.qty) || 0,
      price: typeof body.price === "number" ? body.price : null,
      stopPrice: typeof body.stopPrice === "number" ? body.stopPrice : null,
      reduceOnly: Boolean(body.reduceOnly),
      clientOrderId,
    },
    mark,
    settings.riskLimits
  );

  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  await logAudit("paper_order_placed", {
    symbol, side: body.side, type: body.type, qty: body.qty,
    clientOrderId, deduplicated: result.deduplicated ?? false,
  });

  // Attach optional SL/TP brackets to the resulting position.
  if (typeof body.stop === "number" || typeof body.target === "number") {
    await attachBrackets(
      symbol,
      typeof body.stop === "number" ? body.stop : null,
      typeof body.target === "number" ? body.target : null
    );
  }
  const state = await getPaperState(prices);
  return Response.json({ ...result, ...state });
}
