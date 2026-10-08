/**
 * Trading gateway HTTP server.
 *
 * Responsibilities:
 *   - terminate the server-to-server API used by the Vercel application
 *   - authenticate every /api request with the shared gateway secret
 *   - rate limit, validate and route
 *   - normalise every error into `{ success:false, error:{ code, message, requestId } }`
 *   - log one structured line per request with the correlation id
 *
 * No database, no framework, no third-party runtime dependency: the whole
 * gateway is Node's standard library plus this source tree, which keeps the
 * attack surface and the reasoning surface small.
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig, describeConfig, type GatewayConfig } from "./config.js";
import type { RouteContext, RouteResult } from "./context.js";
import { DeltaClient } from "./delta/client.js";
import { GatewayError, publicError } from "./errors.js";
import { assertMethod, corsFor, readJsonBody, resolveRequestId, sendJson } from "./http.js";
import { OrderLedger } from "./idempotency/ledger.js";
import { createLogger, registerSecretValues, type Logger } from "./logger.js";
import { requireGatewayAuth } from "./middleware/authentication.js";
import { liveRealizedPnlToday } from "./risk/dailyPnl.js";
import { RateLimiter, callerIdentity } from "./middleware/rateLimit.js";
import { handleBalance, handleFills, handleTransactions } from "./routes/account.js";
import { handleOpenOrders, handlePositions } from "./routes/positions.js";
import { handleHealth, handleReady } from "./routes/health.js";
import {
  handleCancelOrder,
  handleClosePosition,
  handleCreateOrder,
  handleOrderStatus,
} from "./routes/orders.js";

export interface GatewayDependencies {
  logger?: Logger;
  client?: DeltaClient;
  ledger?: OrderLedger;
  rateLimiter?: RateLimiter;
  /** Test hook: notified for every routed request (never in production). */
  onRouted?: (info: { method: string; path: string; authenticated: boolean }) => void;
  /**
   * Test seam for the daily realised-P&L figure. Defaults to the production
   * implementation (risk/dailyPnl.ts), which returns null and therefore keeps
   * live submission blocked. It can only be replaced in code, never through
   * configuration or the HTTP API.
   */
  readDailyPnl?: (client: DeltaClient) => Promise<number | null>;
}

export interface GatewayInstance {
  server: http.Server;
  config: GatewayConfig;
  logger: Logger;
  ledger: OrderLedger;
  client: DeltaClient;
  rateLimiter: RateLimiter;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

interface RouteDefinition {
  method: "GET" | "POST";
  path: string;
  authenticated: boolean;
  rateLimitClass: "read" | "order" | null;
  handler: (ctx: RouteContext) => Promise<RouteResult> | RouteResult;
}

const ROUTES: RouteDefinition[] = [
  { method: "GET", path: "/health", authenticated: false, rateLimitClass: null, handler: handleHealth },
  { method: "GET", path: "/ready", authenticated: false, rateLimitClass: null, handler: handleReady },
  { method: "GET", path: "/api/account/balance", authenticated: true, rateLimitClass: "read", handler: handleBalance },
  { method: "GET", path: "/api/account/transactions", authenticated: true, rateLimitClass: "read", handler: handleTransactions },
  { method: "GET", path: "/api/account/fills", authenticated: true, rateLimitClass: "read", handler: handleFills },
  { method: "GET", path: "/api/account/positions", authenticated: true, rateLimitClass: "read", handler: handlePositions },
  { method: "GET", path: "/api/account/orders", authenticated: true, rateLimitClass: "read", handler: handleOpenOrders },
  { method: "GET", path: "/api/orders/status", authenticated: true, rateLimitClass: "read", handler: handleOrderStatus },
  { method: "POST", path: "/api/orders", authenticated: true, rateLimitClass: "order", handler: handleCreateOrder },
  { method: "POST", path: "/api/orders/cancel", authenticated: true, rateLimitClass: "order", handler: handleCancelOrder },
  { method: "POST", path: "/api/orders/close-position", authenticated: true, rateLimitClass: "order", handler: handleClosePosition },
];

export const ROUTE_TABLE = ROUTES.map((route) => `${route.method} ${route.path}`);

export function buildGateway(config: GatewayConfig, deps: GatewayDependencies = {}): GatewayInstance {
  const logger = deps.logger ?? createLogger(config.logLevel);
  registerSecretValues([config.gatewaySecret, config.deltaApiKey, config.deltaApiSecret]);

  const client =
    deps.client ??
    new DeltaClient({
      baseUrl: config.deltaBaseUrl,
      timeoutMs: config.deltaTimeoutMs,
      maxRetries: config.deltaMaxRetries,
      credentials:
        config.deltaApiKey && config.deltaApiSecret
          ? { apiKey: config.deltaApiKey, apiSecret: config.deltaApiSecret }
          : null,
    });

  const ledger = deps.ledger ?? new OrderLedger(config.idempotencyStore, config.idempotencyTtlHours);
  const readDailyPnl = deps.readDailyPnl ?? liveRealizedPnlToday;
  const rateLimiter =
    deps.rateLimiter ??
    new RateLimiter({
      windowMs: config.rateLimitWindowMs,
      readMax: config.rateLimitReadMax,
      orderMax: config.rateLimitOrderMax,
    });

  async function route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const requestId = resolveRequestId(req);
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "gateway.local"}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const cors = corsFor(req, config.corsAllowedOrigins);
    const caller = callerIdentity(req, config.trustProxy);

    let status = 500;
    try {
      // ---- CORS preflight (only for explicitly allowlisted origins) ------
      if (method === "OPTIONS") {
        if (cors.allowedOrigin) {
          status = 204;
          sendJson(res, status, {}, cors.headers);
          return;
        }
        throw new GatewayError("METHOD_NOT_ALLOWED", 405, "OPTIONS is not enabled for this gateway.");
      }

      const definition = ROUTES.find((route) => route.path === path);

      // ---- /health and /ready answer even when unconfigured --------------
      if (!definition) {
        throw new GatewayError("NOT_FOUND", 404, "Unknown gateway endpoint.");
      }
      if (definition.method !== method) {
        throw new GatewayError("METHOD_NOT_ALLOWED", 405, `Use ${definition.method} ${definition.path}.`);
      }

      const isPost = definition.method === "POST";

      // Authenticate BEFORE reading a body or consuming rate-limit budget: an
      // unauthenticated caller must not be able to make the gateway do work.
      // requireGatewayAuth itself fails closed (503) when no secret is set.
      if (definition.authenticated) requireGatewayAuth(req, config.gatewaySecret);

      if (definition.rateLimitClass) {
        rateLimiter.check(`${caller}:${definition.rateLimitClass}`, definition.rateLimitClass);
      }

      let body: unknown = null;
      if (isPost) {
        const raw = await readJsonBody(req, config.bodyLimitBytes, config.requestTimeoutMs);
        body = raw.json;
      }

      deps.onRouted?.({ method, path, authenticated: definition.authenticated });

      const result = await definition.handler({
        req,
        url,
        config,
        client,
        ledger,
        logger,
        requestId,
        body,
        caller,
        readDailyPnl,
      });
      status = result.status;
      sendJson(res, status, { ...result.body, requestId }, cors.headers);
    } catch (error) {
      const { status: errorStatus, body } = publicError(error, requestId);
      status = errorStatus;
      if (errorStatus >= 500) {
        logger.error("request_failed", {
          requestId,
          method,
          path,
          status: errorStatus,
          code: body.error.code,
          detail: error instanceof GatewayError ? error.detail : undefined,
          error: error instanceof Error ? error : undefined,
        });
      } else if (errorStatus !== 401 && errorStatus !== 404) {
        logger.warn("request_rejected", {
          requestId,
          method,
          path,
          status: errorStatus,
          code: body.error.code,
        });
      }
      const headers = errorStatus === 429 && error instanceof GatewayError
        ? { ...cors.headers, "Retry-After": String(error.detail.retryAfterSeconds ?? 1) }
        : cors.headers;
      if (!res.headersSent) sendJson(res, errorStatus, body, headers);
      else res.end();
    } finally {
      logger.debug("request", {
        requestId,
        method,
        path,
        status,
        latencyMs: Date.now() - startedAt,
        caller,
      });
    }
  }

  const server = http.createServer((req, res) => {
    // A stuck socket must not hold a Delta request open indefinitely.
    req.setTimeout(config.requestTimeoutMs, () => req.destroy());
    void route(req, res);
  });

  return {
    server,
    config,
    logger,
    ledger,
    client,
    rateLimiter,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          const address = server.address();
          const port = typeof address === "object" && address ? address.port : config.port;
          resolve({ host: config.host, port });
        });
      }),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  registerSecretValues([config.gatewaySecret, config.deltaApiKey, config.deltaApiSecret]);

  const gateway = buildGateway(config, { logger });
  const summary = describeConfig(config);

  logger.info("gateway_starting", {
    routes: ROUTE_TABLE,
    deltaBaseHost: summary.deltaBaseHost,
    liveExecutionEnabled: summary.liveExecutionEnabled,
    // Variable NAMES only — never values.
    configurationReady: summary.ready,
    missingConfig: summary.missing,
  });

  if (!summary.ready) {
    logger.warn("gateway_not_ready", {
      missingConfig: summary.missing,
      hint: "Authenticated routes fail closed until every listed variable is set.",
    });
  }
  if (summary.liveExecutionEnabled) {
    logger.warn("live_execution_enabled", {
      note: "LIVE order submission is enabled. Live orders also require a verifiable daily P&L (risk/dailyPnl.ts).",
    });
  }

  const compaction = gateway.ledger.compact();
  logger.info("ledger_ready", { records: gateway.ledger.size(), compactedFrom: compaction.before });

  const { host, port } = await gateway.listen();
  logger.info("gateway_listening", { host, port });

  const shutdown = (signal: string): void => {
    logger.info("gateway_stopping", { signal });
    void gateway.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    // Startup failures are logged without stack traces: they can contain env
    // values in some Node versions (e.g. a bad URL with credentials in it).
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        event: "gateway_start_failed",
        message: error instanceof Error ? error.message : "unknown error",
      })}\n`
    );
    process.exit(1);
  });
}
