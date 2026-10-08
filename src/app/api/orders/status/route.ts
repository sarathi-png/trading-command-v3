/**
 * Reconcile a live order by client order id.
 *
 * This is the path out of an UNKNOWN submission: the static-IP gateway asks
 * Delta whether the order exists and records the answer in its ledger, so the
 * order is either confirmed (never resubmitted) or cleared for a fresh attempt.
 *
 * Read-only on the exchange, authenticated like every other /api route, and it
 * never triggers a submission.
 */
import { logAudit } from "@/lib/settings";
import { gatewayOrderStatus, TradingGatewayError } from "@/lib/tradingGateway";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const clientOrderId = new URL(req.url).searchParams.get("clientOrderId")?.trim() ?? "";
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(clientOrderId)) {
    return Response.json(
      { error: "clientOrderId is required and must be 1-32 characters." },
      { status: 400 }
    );
  }

  try {
    const status = await gatewayOrderStatus(clientOrderId);
    await logAudit("live_order_reconciled", {
      clientOrderId,
      status: status.status,
      ledgerState: status.ledgerState,
    });
    return Response.json({
      clientOrderId,
      status: status.status,
      order: status.order,
      ledgerState: status.ledgerState,
      ...(status.status === "unknown" ? { detail: status.reason } : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not reconcile the order";
    const code = e instanceof TradingGatewayError ? e.code : "GATEWAY_ERROR";
    return Response.json({ error: message, code, clientOrderId }, { status: 502 });
  }
}
