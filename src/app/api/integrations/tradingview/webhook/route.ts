/**
 * OPTIONAL TradingView webhook receiver — DISABLED by default.
 *
 * Even when enabled this endpoint NEVER places orders. Incoming alerts are
 * validated, normalized into internal Signal objects and stored for the user
 * (or a future automation rule) to act on.
 */
import { getRepo } from "@/lib/repo";
import type { SignalRow } from "@/lib/repo";
import { flags } from "@/lib/flags";
import { getSettings, logAudit } from "@/lib/settings";
import { timingSafeEqual } from "@/lib/auth";
import { parseTradingViewAlert } from "@/lib/integrations/tradingview/payload";
import { tradingViewSignalId } from "@/lib/signalId";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const rate = { windowStart: 0, count: 0 };

export async function POST(req: Request) {
  // Enablement is env-first (TRADINGVIEW_WEBHOOK_ENABLED=true) with a
  // dashboard switch (Settings → TradingView) as the alternative, so the
  // integration can be turned on without restarting the server.
  const settings = await getSettings();
  if (!flags.tradingviewWebhook() && !settings.tradingviewEnabled) {
    return Response.json(
      {
        error:
          "TradingView webhook integration is disabled. Enable it in Settings → TradingView (or set TRADINGVIEW_WEBHOOK_ENABLED=true).",
      },
      { status: 403 }
    );
  }

  // Simple rate limit: 30 requests / minute.
  const now = Date.now();
  if (now - rate.windowStart > 60000) {
    rate.windowStart = now;
    rate.count = 0;
  }
  rate.count += 1;
  if (rate.count > 30) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  // Secret: environment wins, otherwise the value saved in Settings. Compared
  // in constant time so the response cannot be used as a timing oracle.
  const secret = process.env.TRADINGVIEW_WEBHOOK_SECRET || settings.tradingviewSecret;
  const headerSecret = req.headers.get("x-webhook-secret");
  const bodySecret = typeof body.secret === "string" ? body.secret : "";
  const provided = headerSecret ?? bodySecret;
  if (!secret || !provided || !timingSafeEqual(provided, secret)) {
    await logAudit("webhook_rejected", { reason: "bad_secret" });
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Normalize and validate. A missing/non-numeric price or an unmappable
  // interval is refused: storing a placeholder would put invented data in the
  // signal inbox. See docs/WEBHOOKS.md.
  const parsed = parseTradingViewAlert(body, Date.now());
  if (!parsed.ok) {
    await logAudit("webhook_rejected", { reason: "invalid_payload" });
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const alert = parsed.alert;

  const status =
    alert.action === "LONG" ? "LONG_SETUP" : alert.action === "SHORT" ? "SHORT_SETUP" : alert.action === "WATCH" ? "WATCH" : "INVALIDATED";

  // The id is derived from the alert, so a redelivery lands on the same primary
  // key and is deduplicated by the database rather than by per-instance memory.
  const id = await tradingViewSignalId({
    strategy: alert.strategy,
    symbol: alert.symbol,
    action: alert.action,
    timestamp: alert.timestamp,
  });

  const { row, created } = await (await getRepo()).insertSignalOnce({
    id,
    symbol: alert.symbol,
    timeframe: alert.timeframe,
    strategy: `tradingview:${alert.strategy}`,
    status: status as SignalRow["status"],
    price: alert.price,
    entry: alert.entry,
    stop: alert.stop,
    target: alert.target,
    rr: null,
    reasons: [alert.message],
    outcome: "ACTIVE",
  });

  if (!created) {
    await logAudit("webhook_signal_duplicate", { symbol: alert.symbol, action: alert.action, signalId: row.id });
    return Response.json({ ok: true, deduplicated: true, signalId: row.id });
  }

  await logAudit("webhook_signal_accepted", { symbol: alert.symbol, action: alert.action });
  return Response.json({ ok: true, signalId: row.id });
}
