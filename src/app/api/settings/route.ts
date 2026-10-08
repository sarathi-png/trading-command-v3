import { exchangeAccountConfigured } from "@/lib/credentials";
import { flags } from "@/lib/flags";
import { getSettings, logAudit, updateSettings } from "@/lib/settings";
import type { AppSettings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getSettings();
    return Response.json({
      settings,
      capabilities: {
        exchangeAccountConfigured: await exchangeAccountConfigured(),
        exchangeMarket: flags.exchangeMarket(),
        paperTrading: flags.paperTrading(),
        liveExecution: flags.liveExecution(),
        webhook: flags.tradingviewWebhook(),
        orderbook: flags.orderbook(),
        strategyEngine: flags.strategyEngine(),
      },
    });
  } catch {
    return Response.json(
      { error: "Settings storage is unavailable. Check the database connection and apply the dashboard schema." },
      { status: 503 }
    );
  }
}

export async function POST(req: Request) {
  let patch: Partial<AppSettings> & { confirm?: string };
  try {
    patch = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  let current: Awaited<ReturnType<typeof getSettings>>;
  try {
    current = await getSettings();
  } catch {
    return Response.json(
      { error: "Settings storage is unavailable. Check the database connection and apply the dashboard schema." },
      { status: 503 }
    );
  }

  // ---- execution-mode safety gates ---------------------------------------
  if (patch.mode === "live" && !flags.liveExecution()) {
    return Response.json(
      { error: "LIVE mode is disabled by configuration (LIVE_EXECUTION_ENABLED=false)." },
      { status: 403 }
    );
  }
  if (patch.liveArmed === true) {
    if (patch.mode !== "live" && current.mode !== "live") {
      return Response.json({ error: "Master switch requires LIVE mode." }, { status: 400 });
    }
    if (patch.confirm !== "ARM-LIVE-TRADING") {
      return Response.json({ error: "Live arming requires explicit confirmation token." }, { status: 400 });
    }
    await logAudit("live_mode_armed", {});
  }
  if (patch.liveArmed === false && current.liveArmed) {
    await logAudit("live_mode_disarmed", {});
  }
  if (patch.mode && patch.mode !== current.mode) {
    await logAudit("settings_changed", { field: "mode", from: current.mode, to: patch.mode });
  }
  if (patch.dataSource && patch.dataSource !== current.dataSource) {
    await logAudit("settings_changed", { field: "dataSource", from: current.dataSource, to: patch.dataSource });
  }

  const { confirm: _c, ...clean } = patch;
  try {
    const next = await updateSettings(clean);
    return Response.json({ settings: next });
  } catch {
    return Response.json(
      { error: "Could not save settings. Check the database connection and apply the dashboard schema." },
      { status: 503 }
    );
  }
}
