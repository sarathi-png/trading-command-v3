import { getRepo } from "@/lib/repo";
import { deltaAccountConfigured } from "@/lib/credentials";
import { flags, APP_VERSION } from "@/lib/flags";
import { deltaPing } from "@/lib/market/delta";
import { getSettings } from "@/lib/settings";
import type { SystemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let pingCache: { at: number; ok: boolean } | null = null;

export async function GET() {
  const settings = await getSettings();

  const repo = await getRepo();
  const dbOk = await repo.probe();

  let deltaMarket: SystemStatus["deltaMarket"] = "disabled";
  if (flags.deltaMarket()) {
    if (!pingCache || Date.now() - pingCache.at > 30000) {
      pingCache = { at: Date.now(), ok: await deltaPing() };
    }
    deltaMarket = pingCache.ok ? "online" : "offline";
  }

  const execution =
    settings.mode === "live"
      ? settings.liveArmed
        ? "LIVE ARMED"
        : "LIVE / EXECUTION DISABLED"
      : settings.mode === "paper"
        ? "PAPER MODE"
        : "READ ONLY";

  // Credentials count when they come from the environment OR the encrypted
  // database row (Settings → Delta API) — see lib/credentials.ts.
  const deltaCreds = await deltaAccountConfigured();

  const status: SystemStatus = {
    db: dbOk,
    deltaMarket,
    deltaAccount: deltaCreds
      ? settings.dataSource === "delta"
        ? "configured"
        : "disconnected"
      : "disabled",
    strategy: flags.strategyEngine(),
    execution,
    webhook: flags.tradingviewWebhook() || settings.tradingviewEnabled,
    demoMode: settings.dataSource === "demo",
    latencyMs: null,
    version: APP_VERSION,
    flags: {
      DELTA_MARKET: flags.deltaMarket(),
      DELTA_ACCOUNT: deltaCreds,
      PAPER_TRADING: flags.paperTrading(),
      LIVE_EXECUTION: flags.liveExecution(),
      ORDERBOOK: flags.orderbook(),
      STRATEGY_ENGINE: flags.strategyEngine(),
      AUTO_S_R: flags.autoSR(),
      JOURNAL: flags.journal(),
      ANALYTICS: flags.analytics(),
      TRADINGVIEW_WEBHOOK: flags.tradingviewWebhook() || settings.tradingviewEnabled,
      TELEGRAM: flags.telegram(),
    },
  };
  return Response.json(status);
}
