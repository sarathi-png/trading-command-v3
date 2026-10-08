/**
 * Private account reads.
 *
 * These routes replace the signed Delta calls the application used to make
 * directly from Vercel. They return Delta's payload unchanged inside a
 * `{ success, result }` envelope; all derivation (P&L, journal, analytics)
 * stays in the application, where it already lives.
 *
 * Every route is authenticated server-to-server before it gets here.
 */
import type { RouteContext, RouteResult } from "../context.js";
import { walletBalances, walletTransactions, fills } from "../delta/account.js";
// Positions and open orders live in ./positions.js (they are keyed differently).

export async function handleBalance(ctx: RouteContext): Promise<RouteResult> {
  const { result } = await walletBalances(ctx.client);
  return { status: 200, body: { success: true, result, requestId: ctx.requestId } };
}

export async function handleTransactions(ctx: RouteContext): Promise<RouteResult> {
  const pageSize = Number(ctx.url.searchParams.get("page_size") ?? 200);
  const { result } = await walletTransactions(ctx.client, pageSize);
  return { status: 200, body: { success: true, result, requestId: ctx.requestId } };
}

export async function handleFills(ctx: RouteContext): Promise<RouteResult> {
  const pageSize = Number(ctx.url.searchParams.get("page_size") ?? 500);
  const { result } = await fills(ctx.client, pageSize);
  return { status: 200, body: { success: true, result, requestId: ctx.requestId } };
}
