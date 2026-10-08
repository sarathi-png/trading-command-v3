/**
 * LIVE order endpoint (Vercel side).
 *
 * Four independent gates must all pass before anything is sent:
 *   1. LIVE_EXECUTION_ENABLED=true (environment)
 *   2. settings.mode === "live"
 *   3. settings.liveArmed === true (master switch, confirmation token)
 *   4. the trading gateway is configured (TRADING_GATEWAY_URL + SECRET)
 *
 * Then the order must clear the SAME risk evaluation that guards paper fills
 * (see lib/risk.ts), and it carries a client_order_id so a retry returns the
 * original result instead of placing a second order.
 *
 * WHERE THE ORDER GOES: not to Delta. Vercel cannot present a dedicated
 * outbound IPv4 for Delta's IP allowlist, so the order is sent to the
 * static-IP trading gateway, which signs it with the Delta secret and submits
 * it exactly once. That gateway enforces its own (stricter) copy of the risk
 * layer, so a bug or a bypass here still cannot produce an unrestricted order.
 *
 * IDEMPOTENCY IS TWO-LAYERED:
 *   - this route claims the client_order_id in Postgres BEFORE calling the
 *     gateway (a Vercel timeout or a double-click returns the stored row), and
 *   - the gateway keeps its own durable ledger, so even a lost response between
 *     Vercel and the gateway cannot submit the same id twice.
 *
 * `liveRealizedPnlToday()` intentionally still returns null, which the risk
 * layer treats as "unknown" and therefore blocks. The gateway applies the same
 * fail-closed rule independently. Live orders therefore remain closed until a
 * verified daily P&L is implemented in trading-gateway/src/risk/dailyPnl.ts.
 *
 * Authentication is enforced for every /api route by middleware/proxy.ts and is
 * not duplicated here. Default configuration is always 403.
 */
import { deltaAccountConfigured } from "@/lib/credentials";
import { flags } from "@/lib/flags";
import { deltaTickers } from "@/lib/market/delta";
import { evaluateOrderRisk, normalizeRiskLimits } from "@/lib/risk";
import { getSettings, logAudit } from "@/lib/settings";
import {
  baseAssetOf,
  gatewayCreateOrder,
  livePositions,
  liveWalletBalances,
  newClientOrderId,
  TradingGatewayError,
} from "@/lib/tradingGateway";
import { getRepo } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Realised P&L since UTC midnight for the live account.
 *
 * NOT IMPLEMENTED — returns null, which the risk layer treats as "unknown" and
 * therefore blocks. A daily-loss limit that assumes zero realised loss is not a
 * limit, so live orders stay closed until this reads actual fills from the
 * exchange (sum realised_pnl over today's fills) and caches it.
 *
 * The gateway enforces the identical rule in its own process
 * (trading-gateway/src/risk/dailyPnl.ts). Implementing the figure here alone is
 * NOT enough, and implementing it there alone is not enough either — both
 * layers fail closed by design. See docs/SECURITY.md.
 */
async function liveRealizedPnlToday(): Promise<number | null> {
  return null;
}

export async function GET() {
  const settings = await getSettings();
  return Response.json({
    liveExecutionFlag: flags.liveExecution(),
    mode: settings.mode,
    liveArmed: settings.liveArmed,
    deltaConfigured: await deltaAccountConfigured(),
    routedVia: "trading-gateway",
  });
}

export async function POST(req: Request) {
  const settings = await getSettings();

  if (!flags.liveExecution()) {
    await logAudit("live_order_rejected", { reason: "flag_disabled" });
    return Response.json(
      { error: "Live execution is disabled by configuration (LIVE_EXECUTION_ENABLED=false)." },
      { status: 403 }
    );
  }
  if (settings.mode !== "live" || !settings.liveArmed) {
    await logAudit("live_order_rejected", { reason: "not_armed", mode: settings.mode });
    return Response.json(
      { error: "Live trading is not armed. Enable LIVE mode and the master switch first." },
      { status: 403 }
    );
  }
  if (!(await deltaAccountConfigured())) {
    await logAudit("live_order_rejected", { reason: "gateway_not_configured" });
    return Response.json(
      { error: "The trading gateway is not configured, so live orders cannot be routed." },
      { status: 403 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const symbol = String(body.symbol ?? "").toUpperCase();
  const side = body.side === "sell" ? "sell" : "buy";
  const type = body.type === "limit_order" ? "limit_order" : "market_order";
  const size = Math.abs(Number(body.size) || 0);
  const reduceOnly = Boolean(body.reduce_only);
  const limitPrice = typeof body.limit_price === "number" ? body.limit_price : null;

  if (!symbol || size <= 0) {
    return Response.json({ error: "symbol and positive size are required" }, { status: 400 });
  }

  // ---- idempotency (layer 1: Postgres) -----------------------------------
  // A retried request must return the first result, never place a second order.
  // clientOrderId is capped at 32 characters — Delta's documented maximum for
  // `client_order_id`; the previous format (tc-<timestamp>-<uuid>, 53 chars)
  // would have been rejected by the exchange.
  const clientOrderId =
    typeof body.client_order_id === "string" && body.client_order_id.trim()
      ? body.client_order_id.trim().slice(0, 32)
      : newClientOrderId();

  const repo = await getRepo();
  const existing = await repo.findLiveOrderByClientId(clientOrderId);
  if (existing) {
    // A previously UNKNOWN submission must be reconciled, never resubmitted:
    // the order may already exist at Delta.
    if (existing.status === "unknown") {
      await logAudit("live_order_blocked_unknown", { clientOrderId, symbol });
      return Response.json(
        {
          error:
            "A previous attempt with this client_order_id has an UNKNOWN outcome at Delta. Reconcile it before retrying.",
          code: "ORDER_STATUS_UNKNOWN",
          clientOrderId,
          reconcile: `/api/orders/status?clientOrderId=${encodeURIComponent(clientOrderId)}`,
        },
        { status: 409 }
      );
    }
    await logAudit("live_order_deduplicated", { clientOrderId, symbol });
    return Response.json({
      ok: true,
      deduplicated: true,
      clientOrderId,
      order: existing.response,
      status: existing.status,
    });
  }

  // ---- reference price for the risk maths --------------------------------
  let referencePrice: number;
  try {
    if (type === "limit_order" && limitPrice !== null) {
      referencePrice = limitPrice;
    } else {
      const tickers = await deltaTickers();
      const found = tickers.find((t) => t.symbol === symbol);
      referencePrice = found?.price ?? 0;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not read a reference price";
    await logAudit("live_order_failed", { clientOrderId, symbol, error: msg });
    return Response.json({ error: msg }, { status: 502 });
  }

  // ---- risk evaluation (application layer) -------------------------------
  const limits = normalizeRiskLimits(settings.riskLimits);
  let openSymbols: string[] = [];
  let currentNotional = 0;
  let equity = 0;
  try {
    const [positions, balances] = await Promise.all([livePositions(), liveWalletBalances()]);
    openSymbols = positions.map((p) => p.symbol);
    currentNotional = positions.reduce((a, p) => a + Math.abs(p.qty) * (p.mark || p.entry), 0);
    const usd = balances.find((b) => b.asset === "USD" || b.asset === "USDC");
    equity = usd?.balance ?? 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not read live account state";
    await logAudit("live_order_failed", { clientOrderId, symbol, error: msg });
    return Response.json({ error: msg }, { status: 502 });
  }

  const verdict = evaluateOrderRisk(
    { symbol, qty: size, price: referencePrice, reduceOnly },
    {
      limits,
      openSymbols,
      currentNotional,
      equity,
      dailyRealizedPnl: await liveRealizedPnlToday(),
    }
  );
  if (!verdict.allowed) {
    await logAudit("risk_block_triggered", {
      scope: "live",
      clientOrderId,
      symbol,
      side,
      size,
      code: verdict.code,
      reason: verdict.reason,
    });
    return Response.json(
      { error: `Blocked by risk limit: ${verdict.reason}`, code: verdict.code },
      { status: 403 }
    );
  }

  // ---- claim the idempotency key, then submit through the gateway --------
  await repo.insertLiveOrder({
    clientOrderId,
    symbol,
    side,
    type,
    size,
    price: referencePrice,
    status: "pending",
  });

  try {
    const result = await gatewayCreateOrder({
      symbol,
      side,
      size,
      type,
      limitPrice,
      reduceOnly,
      clientOrderId,
      // Base assets the gateway should inspect for its own exposure maths.
      underlyingAssets: [...new Set(settings.watchlist.map((s) => baseAssetOf(s)).filter(Boolean))],
      riskLimits: limits as unknown as Record<string, unknown>,
    });

    await repo.updateLiveOrderByClientId(clientOrderId, {
      status: "submitted",
      response: (result.order ?? null) as Record<string, unknown> | null,
    });

    await logAudit("live_order_placed", {
      clientOrderId,
      symbol,
      side,
      type,
      size,
      deduplicated: result.deduplicated,
      routedVia: "trading-gateway",
    });
    return Response.json({
      ok: true,
      clientOrderId,
      order: result.order,
      deduplicated: result.deduplicated,
      risk: result.risk,
    });
  } catch (e) {
    // An uncertain outcome is recorded as such and NEVER retried. The operator
    // reconciles with GET /api/orders/status?clientOrderId=...
    const isUnknown = e instanceof TradingGatewayError && e.upstreamCode === "ORDER_STATUS_UNKNOWN";
    const message = e instanceof Error ? e.message : "Live order failed";

    await repo.updateLiveOrderByClientId(clientOrderId, {
      status: isUnknown ? "unknown" : "failed",
    });
    await logAudit(isUnknown ? "live_order_unknown" : "live_order_failed", {
      clientOrderId,
      symbol,
      error: message,
      code: e instanceof TradingGatewayError ? e.upstreamCode ?? e.code : undefined,
    });

    return Response.json(
      {
        error: message,
        code: e instanceof TradingGatewayError ? e.upstreamCode ?? e.code : "LIVE_ORDER_FAILED",
        clientOrderId,
        ...(isUnknown
          ? {
              reconcile: `/api/orders/status?clientOrderId=${encodeURIComponent(clientOrderId)}`,
              guidance:
                "The order may or may not exist at Delta. Reconcile before doing anything else — do not resubmit.",
            }
          : {}),
      },
      { status: 502 }
    );
  }
}
