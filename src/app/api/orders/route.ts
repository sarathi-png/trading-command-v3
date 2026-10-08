/**
 * LIVE order endpoint (Vercel side).
 *
 * Four independent gates must all pass before anything is sent:
 *   1. LIVE_EXECUTION_ENABLED=true (environment)
 *   2. settings.mode === "live"
 *   3. settings.liveArmed === true (master switch, confirmation token)
 *   4. COINDCX_API_KEY + COINDCX_API_SECRET present on this deployment
 *
 * Then the order must clear the SAME risk evaluation that guards paper fills
 * (see lib/risk.ts).
 *
 * WHERE THE ORDER GOES: straight to CoinDCX from this serverless function. The
 * previous static-IP gateway hop existed only because Delta refuses trading keys
 * from a non-allowlisted IP; CoinDCX does not require an IP-bound key, so the
 * gateway is gone from the request path.
 *
 * IDEMPOTENCY WITHOUT A CLIENT ORDER ID
 *   CoinDCX futures has NO client order id field, so there is no venue-side
 *   deduplication to lean on. This route therefore:
 *     1. claims the request in Postgres BEFORE submitting (unique constraint on
 *        client_order_id, so a double-click or a retried request finds the row);
 *     2. submits EXACTLY ONCE — never an automatic retry;
 *     3. if the submission ends without a definitive answer, records
 *        status='unknown' and RECONCILES by scanning the venue's recent orders,
 *        because "the order may exist" is not "the order does not exist".
 *
 * `liveRealizedPnlToday()` reads the venue and returns null whenever the figure
 * cannot be proven, which the risk layer treats as "unknown" and therefore
 * blocks. liveArmed plus LIVE_EXECUTION_ENABLED=false keep submission off by
 * default; nothing here can enable it.
 *
 * Authentication is enforced for every /api route by middleware/proxy.ts and is
 * not duplicated here. Default configuration is always 403.
 */
import { exchangeAccountConfigured } from "@/lib/credentials";
import { flags } from "@/lib/flags";
import {
  exchangeCapabilities,
  liveBalances,
  livePositions,
  marketTickers,
  realizedPnlTodayUtc,
  reconcileLiveSubmission,
  submitLiveOrder,
  toExchangeSymbol,
  ExchangeError,
} from "@/lib/exchange/service";
import { orderOutcomeKnown } from "@/lib/exchange/errors";
import { isSupportedSymbol } from "@/lib/exchange/symbols";
import { evaluateOrderRisk, normalizeRiskLimits } from "@/lib/risk";
import { getSettings, logAudit } from "@/lib/settings";
import { getRepo } from "@/lib/repo";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Realised P&L since UTC midnight for the live account.
 *
 * Reads CoinDCX's position transactions and returns the booked P&L, or null
 * when it cannot be PROVEN (venue unreachable, truncated page, unknown timestamp)
 * — which the risk layer treats as "unknown" and therefore blocks. A daily-loss
 * limit that assumes zero realised loss is not a limit.
 *
 * The gateway used to enforce the identical rule in its own process; that layer
 * is no longer on the path, so this is now the only enforcement point and it
 * fails closed by design. See docs/SECURITY.md.
 */
async function liveRealizedPnlToday(): Promise<number | null> {
  return realizedPnlTodayUtc();
}

/** Request key that makes a submission idempotent across retries. */
function newClientOrderId(): string {
  return `tc-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 12)}`;
}

export async function GET() {
  const settings = await getSettings();
  const capabilities = exchangeCapabilities();
  return Response.json({
    liveExecutionFlag: flags.liveExecution(),
    mode: settings.mode,
    liveArmed: settings.liveArmed,
    exchangeConfigured: await exchangeAccountConfigured(),
    routedVia: "direct",
    capabilities: {
      clientOrderIds: capabilities.clientOrderIds,
      orderReconciliation: capabilities.orderReconciliation,
      reduceOnlyOrders: capabilities.reduceOnlyOrders,
    },
  });
}

interface LiveOrderBody {
  symbol?: unknown;
  side?: unknown;
  type?: unknown;
  size?: unknown;
  reduce_only?: unknown;
  limit_price?: unknown;
  client_order_id?: unknown;
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
  if (!(await exchangeAccountConfigured())) {
    await logAudit("live_order_rejected", { reason: "exchange_not_configured" });
    return Response.json(
      { error: "CoinDCX API credentials are not configured on this deployment, so live orders cannot be sent." },
      { status: 403 }
    );
  }

  let body: LiveOrderBody;
  try {
    body = (await req.json()) as LiveOrderBody;
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
  if (!isSupportedSymbol(symbol)) {
    // Fail before any network call: an unsupported pair must never be mapped
    // onto some other instrument.
    return Response.json(
      { error: `${symbol} is not a supported CoinDCX futures instrument on this deployment.` },
      { status: 422 }
    );
  }
  if (reduceOnly) {
    // CoinDCX expresses "reduce only" by closing the position
    // (positions/exit), not by a flag on order creation. Silently dropping the
    // flag could OPEN a position the operator meant to reduce, so this refuses.
    await logAudit("live_order_rejected", { reason: "reduce_only_unsupported", symbol });
    return Response.json(
      {
        error:
          "CoinDCX has no reduce-only order flag. Use the close-position action, which sends positions/exit.",
        code: "REDUCE_ONLY_UNSUPPORTED",
      },
      { status: 422 }
    );
  }

  // ---- idempotency (Postgres) -------------------------------------------
  const clientOrderId =
    typeof body.client_order_id === "string" && body.client_order_id.trim()
      ? body.client_order_id.trim().slice(0, 64)
      : newClientOrderId();

  const repo = await getRepo();
  const existing = await repo.findLiveOrderByClientId(clientOrderId);
  if (existing) {
    if (existing.status === "unknown") {
      // A previously UNKNOWN submission must be reconciled, never resubmitted.
      await logAudit("live_order_blocked_unknown", { clientOrderId, symbol });
      return Response.json(
        {
          error:
            "A previous attempt with this client_order_id has an UNKNOWN outcome at CoinDCX. Reconcile it before retrying.",
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
      const tickers = await marketTickers([symbol]);
      referencePrice = tickers.find((t) => t.symbol === symbol)?.price ?? 0;
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
    const [positions, balances] = await Promise.all([livePositions(), liveBalances()]);
    openSymbols = positions.map((p) => p.symbol);
    currentNotional = positions.reduce((a, p) => a + Math.abs(p.qty) * (p.mark || p.entry), 0);
    const margin = balances.find((b) => b.asset === "USDT" || b.asset === "USD" || b.asset === "USDC");
    equity = margin?.balance ?? 0;
  } catch (e) {
    // Unreadable account state means the risk maths cannot be trusted.
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

  // ---- claim the idempotency key, then submit exactly once ---------------
  const claimedAt = Date.now();
  try {
    await repo.insertLiveOrder({
      clientOrderId,
      symbol,
      side,
      type,
      size,
      price: referencePrice,
      status: "pending",
      exchange: "coindcx",
      symbolCanonical: symbol,
      exchangeSymbol: toExchangeSymbol(symbol),
    });
  } catch (e) {
    // Unique-constraint loss means a concurrent request claimed this id first:
    // treat it as a duplicate rather than as a failure.
    const raced = await repo.findLiveOrderByClientId(clientOrderId);
    if (raced) {
      return Response.json(
        { ok: true, deduplicated: true, clientOrderId, order: raced.response, status: raced.status },
        { status: 200 }
      );
    }
    const msg = e instanceof Error ? e.message : "Could not claim the order slot";
    return Response.json({ error: msg }, { status: 500 });
  }

  try {
    const outcome = await submitLiveOrder({
      symbol,
      side,
      type: type === "limit_order" ? "limit" : "market",
      quantity: size,
      price: limitPrice,
      // Leverage is deliberately NOT sent: the adapter aligns it with the
      // existing position when the venue requires a match, and never changes a
      // position's leverage as a side effect of placing an order.
      reduceOnly: false,
    });

    await repo.updateLiveOrderByClientId(clientOrderId, {
      status: "submitted",
      exchangeOrderId: outcome.order?.id ?? null,
      exchangeSymbol: outcome.order?.exchangeSymbol ?? null,
      response: (outcome.order ?? null) as unknown as Record<string, unknown> | null,
    });

    await logAudit("live_order_placed", {
      clientOrderId,
      symbol,
      side,
      type,
      size,
      exchange: "coindcx",
      exchangeOrderId: outcome.order?.id ?? null,
      routedVia: "direct",
    });
    return Response.json({
      ok: true,
      clientOrderId,
      order: outcome.order,
      deduplicated: false,
      risk: { limits, orderValue: verdict.orderValue },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Live order failed";
    const code = e instanceof ExchangeError ? e.code : "LIVE_ORDER_FAILED";

    // The adapter reports an uncertain submission instead of throwing, but guard
    // both shapes: anything that is not a clean venue refusal is UNKNOWN.
    const uncertain = e instanceof ExchangeError && !orderOutcomeKnown(e);

    await repo.updateLiveOrderByClientId(clientOrderId, {
      status: uncertain ? "unknown" : "failed",
    });
    await logAudit(uncertain ? "live_order_unknown" : "live_order_failed", {
      clientOrderId,
      symbol,
      error: message,
      code,
    });

    if (!uncertain) {
      return Response.json({ error: message, code, clientOrderId }, { status: 502 });
    }

    // ---- reconcile: the order may exist, so never resubmit ----------------
    const verdictNow = await reconcileLiveSubmission({
      symbol,
      side,
      quantity: size,
      sinceMs: claimedAt,
    });

    if (verdictNow.status === "found") {
      await repo.updateLiveOrderByClientId(clientOrderId, {
        status: "submitted",
        exchangeOrderId: verdictNow.order.id,
        exchangeSymbol: verdictNow.order.exchangeSymbol,
        response: verdictNow.order as unknown as Record<string, unknown>,
      });
      await logAudit("live_order_reconciled", {
        clientOrderId,
        symbol,
        exchangeOrderId: verdictNow.order.id,
        via: "recovery",
      });
      return Response.json({
        ok: true,
        clientOrderId,
        order: verdictNow.order,
        reconciled: true,
        deduplicated: false,
      });
    }

    if (verdictNow.status === "not_found") {
      // Provably nothing was created: the scan reached the end of the venue's
      // order history and found no match in the window.
      await repo.updateLiveOrderByClientId(clientOrderId, { status: "failed" });
      await logAudit("live_order_failed", { clientOrderId, symbol, reconciled: "not_found" });
      return Response.json(
        {
          error: message,
          code,
          clientOrderId,
          reconciled: "not_found",
          guidance:
            "CoinDCX has no matching order, so nothing was created. A retry must use a NEW client_order_id.",
        },
        { status: 502 }
      );
    }

    // Ambiguous: the operator decides. The row stays 'unknown' so a retry of
    // this client_order_id is refused above.
    return Response.json(
      {
        error: message,
        code,
        clientOrderId,
        reconciled: "unknown",
        detail: verdictNow.reason,
        reconcile: `/api/orders/status?clientOrderId=${encodeURIComponent(clientOrderId)}`,
        guidance:
          "The order may or may not exist at CoinDCX. Reconcile before doing anything else — do not resubmit.",
      },
      { status: 409 }
    );
  }
}
