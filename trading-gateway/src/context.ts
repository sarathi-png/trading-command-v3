/** Shared request context passed to every route handler. */
import type { IncomingMessage } from "node:http";
import type { GatewayConfig } from "./config.js";
import type { DeltaClient } from "./delta/client.js";
import type { OrderLedger } from "./idempotency/ledger.js";
import type { Logger } from "./logger.js";

export interface RouteContext {
  req: IncomingMessage;
  url: URL;
  config: GatewayConfig;
  client: DeltaClient;
  ledger: OrderLedger;
  logger: Logger;
  requestId: string;
  /** Parsed JSON body (null for GETs and empty bodies). */
  body: unknown;
  /** Rate-limit identity of the caller. */
  caller: string;
  /**
   * Realised P&L since UTC midnight for the live account.
   *
   * Production implementation: risk/dailyPnl.ts → returns null → the order is
   * blocked. It is a dependency rather than a direct import purely so tests can
   * exercise the submission path; nothing in the configuration or the HTTP API
   * can replace it at runtime.
   */
  readDailyPnl: (client: DeltaClient) => Promise<number | null>;
}

export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}
