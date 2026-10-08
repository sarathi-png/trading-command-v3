/**
 * Server-side client for the static-IP Trading Gateway.
 *
 * This module is the ONLY way the application reaches a private Delta endpoint
 * after the migration. It is server-only by construction:
 *
 *   - it reads `TRADING_GATEWAY_URL` and `TRADING_GATEWAY_SECRET`, neither of
 *     which is prefixed `NEXT_PUBLIC_`, so neither can reach the browser bundle
 *   - it sends the secret in an `Authorization: Bearer` header, server-to-server
 *   - it never logs or echoes the secret, and never returns upstream bodies raw
 *   - it fails CLOSED: with no configuration every private call throws
 *     `GATEWAY_NOT_CONFIGURED` rather than silently doing something else
 *
 * Retry policy mirrors the gateway's own rule and never weakens it:
 * read-only GETs may be retried (they have no side effect); order mutations are
 * attempted once. An uncertain order response is surfaced, never retried —
 * double-submitting a real order is the failure mode that costs money.
 */
import crypto from "node:crypto";

export type GatewayErrorCode =
  | "GATEWAY_NOT_CONFIGURED"
  | "GATEWAY_UNAUTHORIZED"
  | "GATEWAY_TIMEOUT"
  | "GATEWAY_UNAVAILABLE"
  | "GATEWAY_BAD_RESPONSE"
  | "GATEWAY_RATE_LIMITED"
  | "GATEWAY_UPSTREAM_ERROR";

export class TradingGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: GatewayErrorCode,
    public readonly status: number,
    public readonly requestId?: string,
    /** Machine-readable code from the gateway (e.g. RISK_BLOCKED). */
    public readonly upstreamCode?: string,
    public readonly detail?: Record<string, unknown>
  ) {
    super(message);
    this.name = "TradingGatewayError";
  }

  /** True when the caller may safely retry with the same client_order_id. */
  get retryable(): boolean {
    return this.code === "GATEWAY_TIMEOUT" || this.code === "GATEWAY_UNAVAILABLE";
  }
}

export interface GatewayConfigState {
  configured: boolean;
  /** Host of the configured gateway, or null. Never includes a secret. */
  host: string | null;
  /** True when TRADING_GATEWAY_URL is set but TRADING_GATEWAY_SECRET is not. */
  misconfigured: boolean;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.TRADING_GATEWAY_TIMEOUT_MS ?? 12_000) || 12_000;

/** Resolved gateway endpoint + secret. Returns null when either is unset. */
function resolved(): { url: string; secret: string } | null {
  const url = (process.env.TRADING_GATEWAY_URL ?? "").trim().replace(/\/+$/, "");
  const secret = (process.env.TRADING_GATEWAY_SECRET ?? "").trim();
  if (!url || !secret) return null;
  return { url, secret };
}

/**
 * Status for the UI/health endpoints. Deliberately reports only whether the
 * gateway is configured and its host — never the secret, never a key.
 */
export function gatewayConfigState(): GatewayConfigState {
  const url = (process.env.TRADING_GATEWAY_URL ?? "").trim();
  const secret = (process.env.TRADING_GATEWAY_SECRET ?? "").trim();
  let host: string | null = null;
  if (url) {
    try {
      host = new URL(url).host;
    } catch {
      host = "invalid-url";
    }
  }
  return {
    configured: Boolean(url && secret),
    host,
    misconfigured: Boolean(url) !== Boolean(secret),
  };
}

export function gatewayConfigured(): boolean {
  return gatewayConfigState().configured;
}

/** Correlation id shared with the gateway logs. */
export function newRequestId(): string {
  return `vc_${crypto.randomUUID()}`;
}

interface RequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
  requestId?: string;
  /** Only ever true for read-only requests. */
  retries?: number;
  /**
   * Statuses whose body should be returned instead of thrown. Use only for
   * probes that need the gateway's own explanation of a non-2xx answer
   * (see gatewayHealth, which reads the /ready readiness envelope). Requests
   * that move money must never opt in: an unexpected status there has to fail.
   */
  acceptStatuses?: number[];
}

function buildUrl(base: string, path: string, query?: RequestOptions["query"]): string {
  const search = Object.entries(query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${base}${path}${search ? `?${search}` : ""}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform one authenticated gateway request.
 *
 * Returns the parsed body (already validated to be a `success: true` payload),
 * or throws TradingGatewayError with a normalized code. The gateway's error
 * envelope is preserved: `message` is safe to show, `code` is safe to branch
 * on, and `requestId` ties the failure to the gateway log line.
 */
export async function gatewayRequest<T = Record<string, unknown>>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const config = resolved();
  const state = gatewayConfigState();
  const requestId = options.requestId ?? newRequestId();

  if (!config) {
    throw new TradingGatewayError(
      state.misconfigured
        ? "The Trading Gateway is partially configured: set BOTH TRADING_GATEWAY_URL and TRADING_GATEWAY_SECRET."
        : "The Trading Gateway is not configured. Private Delta operations are unavailable (set TRADING_GATEWAY_URL and TRADING_GATEWAY_SECRET).",
      "GATEWAY_NOT_CONFIGURED",
      503,
      requestId
    );
  }

  const method = options.method ?? "GET";
  // A mutation is attempted exactly once: see the module docstring.
  const attempts = method === "GET" ? 1 + (options.retries ?? 1) : 1;
  const url = buildUrl(config.url, path, options.query);
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(250 * attempt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${config.secret}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Request-Id": requestId,
          "X-Client": "trading-command-vercel",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        cache: "no-store",
      });

      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }

      const envelope = (parsed ?? {}) as {
        success?: boolean;
        error?: { code?: string; message?: string; requestId?: string; detail?: Record<string, unknown> };
      };

      if (!response.ok || envelope.success === false) {
        const upstreamCode = envelope.error?.code;
        const status = response.status;
        if (options.acceptStatuses?.includes(status) && parsed !== null) {
          return parsed as T;
        }
        const canRetry =
          method === "GET" && (status === 429 || status === 502 || status === 503 || status === 504);
        if (canRetry && attempt < attempts - 1) {
          lastError = new TradingGatewayError(
            envelope.error?.message ?? "The trading gateway is temporarily unavailable.",
            status === 429 ? "GATEWAY_RATE_LIMITED" : "GATEWAY_UNAVAILABLE",
            status,
            envelope.error?.requestId ?? requestId,
            upstreamCode
          );
          continue;
        }
        throw new TradingGatewayError(
          envelope.error?.message ?? `The trading gateway refused the request (HTTP ${status}).`,
          classify(status, upstreamCode),
          status,
          envelope.error?.requestId ?? requestId,
          upstreamCode,
          envelope.error?.detail
        );
      }

      if (parsed === null || typeof parsed !== "object") {
        throw new TradingGatewayError(
          "The trading gateway returned a response that could not be parsed.",
          "GATEWAY_BAD_RESPONSE",
          502,
          requestId
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof TradingGatewayError) throw error;
      const aborted = error instanceof Error && error.name === "AbortError";
      const wrapped = new TradingGatewayError(
        aborted
          ? `The trading gateway did not answer within ${options.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms.`
          : "The trading gateway could not be reached.",
        aborted ? "GATEWAY_TIMEOUT" : "GATEWAY_UNAVAILABLE",
        504
      );
      // A GET is safe to retry; a POST is not, and its error is surfaced now.
      if (method === "GET" && attempt < attempts - 1) {
        lastError = wrapped;
        continue;
      }
      throw wrapped;
    } finally {
      clearTimeout(timer);
      void startedAt;
    }
  }

  throw lastError instanceof TradingGatewayError
    ? lastError
    : new TradingGatewayError("The trading gateway could not be reached.", "GATEWAY_UNAVAILABLE", 502);
}

function classify(status: number, upstreamCode?: string): GatewayErrorCode {
  if (status === 401 || status === 403) return "GATEWAY_UNAUTHORIZED";
  if (status === 429) return "GATEWAY_RATE_LIMITED";
  if (status === 504) return "GATEWAY_TIMEOUT";
  if (status === 502 || status === 503) return "GATEWAY_UNAVAILABLE";
  if (upstreamCode) return "GATEWAY_UPSTREAM_ERROR";
  return status >= 500 ? "GATEWAY_UNAVAILABLE" : "GATEWAY_UPSTREAM_ERROR";
}

/**
 * Liveness/readiness of the gateway, for /api/system and the settings panel.
 * Never throws.
 *
 * `reachable` answers "did the gateway process answer at all", which is a
 * different question from "is it ready to sign Delta requests". The gateway's
 * `/ready` endpoint deliberately answers 503 when its own Delta credentials are
 * missing, so a naive "non-2xx means unreachable" reading sends an operator
 * looking for a network fault when the real problem is a missing Delta API key
 * on the gateway host. The three states are reported separately:
 *
 *   reachable + ready      -> configured, credentials present, Delta host known
 *   reachable + !ready     -> the process is up but cannot sign (missing keys)
 *   !reachable             -> network/DNS/TLS/timeout, or the app's secret was
 *                             rejected (401), or the app is not configured
 *
 * Only variable NAMES are ever surfaced, never values.
 */
export async function gatewayHealth(): Promise<{
  reachable: boolean;
  ready: boolean;
  configured: boolean;
  host: string | null;
  liveExecutionEnabled?: boolean;
  /** Environment variable NAMES missing on the gateway (never values). */
  missing?: string[];
  error?: string;
}> {
  const state = gatewayConfigState();
  if (!state.configured) {
    return {
      reachable: false,
      ready: false,
      configured: false,
      host: state.host,
      error: state.misconfigured
        ? "TRADING_GATEWAY_URL and TRADING_GATEWAY_SECRET must both be set."
        : "Trading gateway is not configured.",
    };
  }

  type ReadyEnvelope = {
    ready?: boolean;
    liveExecutionEnabled?: boolean;
    missing?: string[];
    missingConfigCount?: number;
    error?: { code?: string; message?: string };
  };

  let ready: ReadyEnvelope;
  try {
    ready = await gatewayRequest<ReadyEnvelope>("/ready", {
      timeoutMs: 5000,
      retries: 0,
      // Read the gateway's own verdict instead of assuming "non-2xx = down".
      acceptStatuses: [200, 401, 403, 503],
    });
  } catch (error) {
    // No answer at all: nothing listened, or the connection failed.
    return {
      reachable: false,
      ready: false,
      configured: true,
      host: state.host,
      error:
        error instanceof TradingGatewayError
          ? error.message
          : "The trading gateway is unreachable.",
    };
  }

  const missing = Array.isArray(ready.missing) ? ready.missing : undefined;
  const live =
    typeof ready.liveExecutionEnabled === "boolean"
      ? { liveExecutionEnabled: ready.liveExecutionEnabled }
      : {};

  // The app's secret is wrong: the gateway answered, but as a stranger.
  if (ready.error?.code === "UNAUTHORIZED" || ready.error?.code === "FORBIDDEN") {
    return {
      reachable: true,
      ready: false,
      configured: true,
      host: state.host,
      ...live,
      error:
        "The gateway rejected this app's TRADING_GATEWAY_SECRET (HTTP 401): the secret here and on the gateway must be identical.",
    };
  }

  if (ready.ready !== true) {
    const missingText = missing?.length
      ? ` It is missing: ${missing.join(", ")}.`
      : "";
    return {
      reachable: true,
      ready: false,
      configured: true,
      host: state.host,
      ...live,
      ...(missing ? { missing } : {}),
      error: `The gateway is running but cannot sign Delta requests.${missingText}${
        missingText
          ? " Set those variables on the gateway host and restart it."
          : " Check its Delta API key, its IP allowlist at Delta, and its configuration."
      }`,
    };
  }

  return {
    reachable: true,
    ready: true,
    configured: true,
    host: state.host,
    ...live,
    ...(ready.missing ? { missing: ready.missing } : {}),
  };
}
