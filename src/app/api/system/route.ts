/**
 * System status for the header and the STATUS panel.
 *
 * Everything reported here is verified, not assumed:
 *   - `exchangeMarket` is a live public probe (active instruments endpoint)
 *     cached for 30 s;
 *   - `exchangeAccount` reports whether the credentials are present on THIS
 *     deployment, because this process is what signs CoinDCX requests;
 *   - the `exchange` block carries variable NAMES that are unset and whether
 *     live execution is enabled — never a key, a secret or a signature.
 */
import { getRepo } from "@/lib/repo";
import { exchangeAccountConfigured } from "@/lib/credentials";
import { flags, APP_VERSION } from "@/lib/flags";
import { exchangeCapabilities, exchangeConfigState, exchangePing } from "@/lib/exchange/service";
import { getSettings } from "@/lib/settings";
import type { SystemStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let pingCache: { at: number; ok: boolean; error?: string } | null = null;

export async function GET() {
  const settings = await getSettings();

  const repo = await getRepo();
  const dbOk = await repo.probe();

  let exchangeMarket: SystemStatus["exchangeMarket"] = "disabled";
  if (flags.exchangeMarket()) {
    if (!pingCache || Date.now() - pingCache.at > 30000) {
      try {
        await exchangePing();
        pingCache = { at: Date.now(), ok: true };
      } catch (e) {
        pingCache = { at: Date.now(), ok: false, error: e instanceof Error ? e.message : "probe failed" };
      }
    }
    exchangeMarket = pingCache.ok ? "online" : "offline";
  }

  const execution =
    settings.mode === "live"
      ? settings.liveArmed
        ? "LIVE ARMED"
        : "LIVE / EXECUTION DISABLED"
      : settings.mode === "paper"
        ? "PAPER MODE"
        : "READ ONLY";

  const credsConfigured = await exchangeAccountConfigured();
  const config = exchangeConfigState();
  const capabilities = exchangeCapabilities();

  const status: SystemStatus = {
    db: dbOk,
    exchangeMarket,
    exchangeAccount: credsConfigured
      ? settings.dataSource === "live"
        ? "configured"
        : "disconnected"
      : "disabled",
    strategy: flags.strategyEngine(),
    execution,
    webhook: flags.tradingviewWebhook() || settings.tradingviewEnabled,
    demoMode: settings.dataSource === "demo",
    latencyMs: null,
    version: APP_VERSION,
    exchange: {
      configured: credsConfigured,
      exchange: config.exchange,
      baseUrl: config.baseUrl,
      missing: config.missing,
      reachable: pingCache?.ok ?? false,
      liveExecutionEnabled: flags.liveExecution(),
      clientOrderIds: capabilities.clientOrderIds,
      orderReconciliation: capabilities.orderReconciliation,
      ...(pingCache?.error ? { error: pingCache.error } : {}),
    },
    flags: {
      EXCHANGE_MARKET: flags.exchangeMarket(),
      EXCHANGE_ACCOUNT: credsConfigured,
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
