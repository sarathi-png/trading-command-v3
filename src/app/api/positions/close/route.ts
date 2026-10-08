/**
 * Close a live position at market.
 *
 * CoinDCX has no reduce-only order flag, so "reduce/close" is a first-class
 * operation of its own (`POST /positions/exit`) rather than a flag on the order
 * endpoint. Keeping it a separate route is what makes the orders route able to
 * refuse `reduce_only` outright instead of silently sending an order that could
 * INCREASE exposure.
 *
 * Safety:
 *   - the same armed/live/credential gates as POST /api/orders
 *   - the position is read first, so an exit for a flat pair is refused instead
 *     of sending a pointless instruction
 *   - submitted exactly once, never retried
 */
import { exchangeAccountConfigured } from "@/lib/credentials";
import { flags } from "@/lib/flags";
import { closeLivePosition, livePositionFor, ExchangeError } from "@/lib/exchange/service";
import { isSupportedSymbol } from "@/lib/exchange/symbols";
import { getSettings, logAudit } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const settings = await getSettings();

  if (!flags.liveExecution()) {
    return Response.json(
      { error: "Live execution is disabled by configuration (LIVE_EXECUTION_ENABLED=false)." },
      { status: 403 }
    );
  }
  if (settings.mode !== "live" || !settings.liveArmed) {
    return Response.json(
      { error: "Live trading is not armed. Enable LIVE mode and the master switch first." },
      { status: 403 }
    );
  }
  if (!(await exchangeAccountConfigured())) {
    return Response.json(
      { error: "CoinDCX API credentials are not configured on this deployment." },
      { status: 403 }
    );
  }

  let body: { symbol?: unknown };
  try {
    body = (await req.json()) as { symbol?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const symbol = String(body.symbol ?? "").toUpperCase();
  if (!symbol || !isSupportedSymbol(symbol)) {
    return Response.json({ error: `${symbol || "(no symbol)"} is not a supported CoinDCX instrument.` }, { status: 422 });
  }

  try {
    const position = await livePositionFor(symbol);
    if (!position) {
      return Response.json({ error: `No open CoinDCX position on ${symbol}.` }, { status: 409 });
    }

    const result = await closeLivePosition(symbol);
    await logAudit("live_position_closed", {
      symbol,
      qty: position.qty,
      side: position.side,
      positionId: result.positionId,
    });
    return Response.json({ ok: true, symbol, closedQty: position.qty, venue: result.raw });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not close the position";
    const code = e instanceof ExchangeError ? e.code : "CLOSE_FAILED";
    await logAudit("live_position_close_failed", { symbol, error: message, code });
    // An uncertain close is NOT retried automatically. The operator reconciles
    // by reading positions again — a second exit on a flat position is rejected
    // by the venue, but the intent must be re-checked, not assumed.
    const uncertain =
      e instanceof ExchangeError &&
      (e.code === "EXCHANGE_UNKNOWN_RESULT" || e.code === "EXCHANGE_TIMEOUT" || e.code === "EXCHANGE_UNAVAILABLE");
    return Response.json(
      {
        error: message,
        code,
        symbol,
        ...(uncertain
          ? {
              status: "unknown",
              guidance: "The exit may or may not have been accepted. Re-read positions before sending another one.",
            }
          : {}),
      },
      { status: uncertain ? 409 : 502 }
    );
  }
}
