import QRCode from "qrcode";
import { saveTelegramCredentials, telegramStatus, whatsappOptInUrl } from "@/lib/notifications/credentials";
import {
  configured,
  deliveries,
  deliveryConfig,
  saveDeliveryConfig,
  dispatchNotice,
} from "@/lib/notifications/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({
    config: deliveryConfig(),
    telegram: telegramStatus(),
    whatsappOptIn: whatsappOptInUrl() ? { url: whatsappOptInUrl(), qrDataUrl: await QRCode.toDataURL(whatsappOptInUrl()!, { width: 240, margin: 2 }) } : null,
    providers: {
      telegram: configured("telegram"),
      whatsapp: configured("whatsapp"),
    },
    recent: deliveries().slice(-20).reverse(),
    monitor:
      "Watchlist: normal 15m + Heikin-Ashi 5m. Runs while dashboard is open; an external scheduler is required when closed.",
  });
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (["save-telegram", "clear-telegram"].includes(body.action)) {
      if (!(await saveTelegramCredentials(body))) return Response.json({ error: "Encrypted credential storage unavailable" }, { status: 503 });
      return GET();
    }
    if (body.action === "test") {
      const config = deliveryConfig();
      if (!config.enabled)
        return Response.json(
          { error: "Enable notifications before sending a test." },
          { status: 400 },
        );
      const results = await dispatchNotice({
        symbol: "TEST",
        timeframe: "5m",
        chart: "digest",
        strategy: "Connection test",
        direction: "REPORT",
        barTime: Math.floor(Date.now() / 60000) * 60000,
        source: "live",
        entry: null,
        stop: null,
        target: null,
        reasons: ["Connection test only. This is not a trading signal."],
      });
      return Response.json({
        results,
        note: results.length
          ? "See per-channel acceptance status."
          : "No delivery: missing configuration, duplicate test within this minute, or daily cap reached.",
      });
    }
    if (!(await saveDeliveryConfig(body)))
      return Response.json(
        { error: "Settings storage unavailable" },
        { status: 503 },
      );
    return GET();
  } catch {
    return Response.json(
      { error: "Invalid notification request or Telegram configuration. Check token/chat ID, opt-in, and a stable SESSION_SECRET (32+ characters) for encrypted storage." },
      { status: 400 },
    );
  }
}
