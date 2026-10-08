/**
 * Delta private account endpoints (read-only).
 *
 * These mirror exactly what the Vercel application used to call with its own
 * signing, before the migration:
 *
 *   GET /v2/wallet/balances      wallet balances
 *   GET /v2/wallet/transactions  ledger (deposits, cashflow, fees, funding)
 *   GET /v2/fills                executed fills
 *   GET /v2/orders                open orders
 *
 * The gateway returns Delta's payload UNCHANGED (`{ success, result }` plus a
 * non-sensitive `meta` block). Deriving balances/P&L/journals stays in the
 * application, so the gateway stays small and the existing analytics code
 * (src/lib/deltaAccount.ts) keeps its behaviour.
 */
import { DeltaClient } from "./client.js";

const PAGE_SIZE_MAX = 500;

/** GET /v2/wallet/balances */
export async function walletBalances(client: DeltaClient): Promise<{ result: unknown }> {
  const response = await client.get<{ result?: unknown }>("/v2/wallet/balances", {}, { auth: true });
  client.assertSuccess("wallet balances", response);
  return { result: response.json?.result ?? [] };
}

/** GET /v2/wallet/transactions?page_size=N */
export async function walletTransactions(
  client: DeltaClient,
  pageSize = 200
): Promise<{ result: unknown }> {
  const size = Math.min(Math.max(Math.trunc(pageSize) || 200, 1), PAGE_SIZE_MAX);
  const response = await client.get<{ result?: unknown }>(
    "/v2/wallet/transactions",
    { page_size: size },
    { auth: true }
  );
  client.assertSuccess("wallet transactions", response);
  return { result: response.json?.result ?? [] };
}

/** GET /v2/fills?page_size=N */
export async function fills(client: DeltaClient, pageSize = 500): Promise<{ result: unknown }> {
  const size = Math.min(Math.max(Math.trunc(pageSize) || 500, 1), PAGE_SIZE_MAX);
  const response = await client.get<{ result?: unknown }>("/v2/fills", { page_size: size }, { auth: true });
  client.assertSuccess("fills", response);
  return { result: response.json?.result ?? [] };
}
