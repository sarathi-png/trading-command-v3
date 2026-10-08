/**
 * Realised P&L since UTC midnight, for the LIVE account.
 *
 * NOT IMPLEMENTED — and deliberately so.
 *
 * The application has always failed closed here: `liveRealizedPnlToday()`
 * returns `null`, `evaluateOrderRisk` treats `null` as "cannot be verified" and
 * refuses the order. A daily-loss limit that silently assumes zero realised loss
 * is not a limit, so live orders stay closed until the figure can be read from
 * the exchange and trusted.
 *
 * This module exists on the gateway too, because the gateway is the only place
 * that holds Delta credentials and therefore the only place where the figure
 * can eventually be established authoritatively (sum realised P&L over today's
 * fills, in the venue's timezone/UTC-day boundary, cached for a few seconds).
 * Keeping it here means the safety gate is enforced TWICE — in the Vercel risk
 * layer and again on the gateway, which is the last hop before Delta — and it
 * cannot be opened by a client-supplied number.
 *
 * IMPLEMENTING THIS WILL ENABLE LIVE ORDER SUBMISSION. Do not do it casually:
 *
 *   1. Read today's fills: GET /v2/fills (already reachable via delta/fills),
 *      filter to `created_at >= startOfUtcDay`, and sum realised P&L using the
 *      same FIFO matching the dashboard already uses (src/lib/deltaAccount.ts
 *      in the application, `matchTrades`).
 *   2. Decide the day boundary explicitly (UTC midnight, matching the app).
 *   3. Cache the result for ~15 s; a stale number is more dangerous than a
 *      slightly delayed one.
 *   4. If ANY part of the calculation fails, return null — never 0.
 *   5. Only then set LIVE_EXECUTION_ENABLED=true on BOTH the application and
 *      the gateway, with the master switch armed.
 *
 * Until then this returns null, which blocks live orders at both layers.
 */
import type { DeltaClient } from "../delta/client.js";

export async function liveRealizedPnlToday(_client: DeltaClient): Promise<number | null> {
  return null;
}
