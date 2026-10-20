import { validateStrategyConfig } from "@/lib/strategy/v2/types";
import { exchangeAccountConfigured } from "@/lib/credentials";
import { flags } from "@/lib/flags";
import { getSettings, logAudit, updateSettings } from "@/lib/settings";
import { isSupportedSymbol } from "@/lib/exchange/symbols";
import { normalizeRiskLimits } from "@/lib/risk";
import type { AppSettings } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getSettings();
    // Never round-trip the webhook secret to the browser. The UI only needs to
    // know whether one is configured (env takes precedence over stored).
    const { tradingviewSecret, ...safe } = settings;
    return Response.json({
      settings: {
        ...safe,
        tradingviewSecret: "",
        webhookSecretConfigured: Boolean(tradingviewSecret || process.env.TRADINGVIEW_WEBHOOK_SECRET),
      },
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
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return Response.json({ error: "Settings must be an object" }, { status: 400 });
  }
  if (patch.dataSource && !["demo", "live"].includes(patch.dataSource)) {
    return Response.json({ error: "Invalid data source" }, { status: 400 });
  }
  // Arming is a boolean, never a truthy string. Accepting `"yes"`/`1` here is
  // how a confirmation token gets bypassed, so reject the type outright.
  if (patch.liveArmed !== undefined && typeof patch.liveArmed !== "boolean") {
    return Response.json({ error: "liveArmed must be a boolean" }, { status: 400 });
  }
  if (patch.watchlist !== undefined) {
    if (!Array.isArray(patch.watchlist) || patch.watchlist.length === 0 || patch.watchlist.length > 40) {
      return Response.json({ error: "watchlist must be a non-empty array of at most 40 symbols" }, { status: 400 });
    }
    const bad = patch.watchlist.find((s) => typeof s !== "string" || !isSupportedSymbol(s.toUpperCase()));
    if (bad !== undefined) {
      return Response.json({ error: `Unsupported watchlist symbol: ${String(bad)}` }, { status: 400 });
    }
  }
  if (patch.displayCurrency !== undefined && !["usd", "inr"].includes(patch.displayCurrency))
    return Response.json({ error: "Invalid display currency" }, { status: 400 });
  if (patch.usdInrRate !== undefined && (typeof patch.usdInrRate !== "number" || !Number.isFinite(patch.usdInrRate) || patch.usdInrRate <= 0))
    return Response.json({ error: "USD/INR rate must be a positive finite number" }, { status: 400 });
  if (patch.chandelierDonchian !== undefined) {
    try { validateStrategyConfig(patch.chandelierDonchian); }
    catch (e) { return Response.json({ error: e instanceof Error ? e.message : "Invalid strategy settings" }, { status: 400 }); }
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

  if (patch.mode && patch.mode !== current.mode && req.headers.get("x-tc-workspace")) {
    return Response.json({ error: "Switch workspaces instead of changing execution mode inside this profile." }, { status: 400 });
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
  if (patch.riskLimits) {
    // Never persist an unbounded cap; normalize once, at the boundary.
    patch.riskLimits = normalizeRiskLimits({ ...current.riskLimits, ...patch.riskLimits });
  }
  if (patch.riskLimits && JSON.stringify(patch.riskLimits) !== JSON.stringify(current.riskLimits)) {
    // Risk limits are a safety control; changing them is an auditable event.
    await logAudit("settings_changed", {
      field: "riskLimits",
      from: current.riskLimits,
      to: patch.riskLimits,
    });
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
