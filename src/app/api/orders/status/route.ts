/**
 * Reconcile a live order by client order id.
 *
 * This is the path out of an UNKNOWN submission. CoinDCX has no client order
 * id, so there is nothing to ask the venue about directly: the recorded row
 * carries the symbol, side, size and the time the submission was attempted, and
 * `reconcileLiveSubmission()` scans the venue's recent orders for a single
 * match in that window.
 *
 * Three honest answers, and no guessing:
 *   found      → the order exists; the row is updated and returned
 *   not_found  → the venue's order history was fully scanned and nothing
 *                matches, so nothing was created
 *   unknown    → the scan was inconclusive (more history than the scan reached,
 *                or several candidates), so an operator must decide
 *
 * Read-only on the exchange, authenticated like every other /api route, and it
 * never triggers a submission.
 */
import { logAudit } from "@/lib/settings";
import { getRepo } from "@/lib/repo";
import { reconcileLiveSubmission } from "@/lib/exchange/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const clientOrderId = new URL(req.url).searchParams.get("clientOrderId")?.trim() ?? "";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(clientOrderId)) {
    return Response.json(
      { error: "clientOrderId is required and must be 1-64 characters." },
      { status: 400 }
    );
  }

  const repo = await getRepo();
  const row = await repo.findLiveOrderByClientId(clientOrderId);
  if (!row) {
    return Response.json({ error: "No live order was recorded with that client order id." }, { status: 404 });
  }

  // Already resolved: answer from our own record without another venue call.
  if (row.status === "submitted" && row.exchangeOrderId) {
    return Response.json({
      clientOrderId,
      status: "submitted",
      order: row.response,
      exchangeOrderId: row.exchangeOrderId,
      source: "ledger",
    });
  }

  try {
    const verdict = await reconcileLiveSubmission({
      symbol: row.symbol,
      side: row.side === "sell" ? "sell" : "buy",
      quantity: row.size,
      sinceMs: Date.parse(String(row.createdAt)) || Date.now() - 3_600_000,
    });

    if (verdict.status === "found") {
      await repo.updateLiveOrderByClientId(clientOrderId, {
        status: "submitted",
        exchangeOrderId: verdict.order.id,
        exchangeSymbol: verdict.order.exchangeSymbol,
        response: verdict.order as unknown as Record<string, unknown>,
      });
      await logAudit("live_order_reconciled", {
        clientOrderId,
        symbol: row.symbol,
        exchangeOrderId: verdict.order.id,
        via: "api",
      });
      return Response.json({ clientOrderId, status: "submitted", order: verdict.order, source: "exchange" });
    }

    if (verdict.status === "not_found") {
      // Only claim this when the scan provably reached the end of the venue's
      // history. The row stays as it is until an operator retries with a new id.
      await logAudit("live_order_reconciled_not_found", { clientOrderId, symbol: row.symbol });
      return Response.json({
        clientOrderId,
        status: "not_found",
        scanned: verdict.scanned,
        detail: "CoinDCX has no matching order in the submission window; nothing was created.",
      });
    }

    return Response.json({
      clientOrderId,
      status: "unknown",
      scanned: verdict.scanned,
      detail: verdict.reason,
      guidance: "Do not resubmit with this client order id. Decide manually, in the CoinDCX UI if needed.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not reconcile the order";
    return Response.json({ error: message, clientOrderId }, { status: 502 });
  }
}
