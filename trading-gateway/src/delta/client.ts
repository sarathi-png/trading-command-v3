/**
 * Delta Exchange India REST client (private + public paths used internally).
 *
 * The single most important rule in this file:
 *
 *   READ-ONLY REQUESTS MAY BE RETRIED. ORDER MUTATIONS ARE NEVER RETRIED.
 *
 * A retried mutation can double a position: gateway → Delta "create order",
 * Delta fills it, the response is lost, the gateway retries and the exchange
 * sees two orders. So a mutating request is attempted exactly once. When the
 * outcome cannot be established (timeout, socket error, 5xx, 408, 429) the
 * client throws a DELTA_UNKNOWN_RESULT error and the caller must reconcile
 * against the exchange (see routes/orders.ts → GET /api/orders/status).
 *
 * Nothing in this module logs a request body, a signature or a header.
 */
import { GatewayError, deltaUnknownResult } from "../errors.js";
import { buildAuthHeaders, buildUrl, nowSeconds, type DeltaMethod, type QueryValue } from "./signing.js";

export interface DeltaCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface DeltaClientOptions {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  /** Credentials; `null` while the gateway is unconfigured (public paths still work). */
  credentials: DeltaCredentials | null;
  /** Optional hook used by tests to observe outbound requests. */
  onRequest?: (info: { method: DeltaMethod; path: string; authenticated: boolean; attempt: number }) => void;
}

export interface DeltaResult<T = unknown> {
  status: number;
  json: T;
  durationMs: number;
}

/** Delta answers with HTTP 2xx + `success:false` for some business errors. */
function isDeltaFailureBody(json: unknown): { failed: boolean; code?: string } {
  if (!json || typeof json !== "object") return { failed: false };
  const body = json as { success?: unknown; error?: unknown };
  if (body.success === false) {
    const code =
      body.error && typeof body.error === "object" && "code" in body.error
        ? String((body.error as { code?: unknown }).code ?? "")
        : undefined;
    return { failed: true, code: code || undefined };
  }
  return { failed: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

export class DeltaClient {
  constructor(private readonly options: DeltaClientOptions) {}

  private authHeaders(
    method: DeltaMethod,
    path: string,
    query: Record<string, QueryValue>,
    body: string
  ): Record<string, string> {
    const credentials = this.options.credentials;
    if (!credentials) {
      throw new GatewayError(
        "GATEWAY_NOT_CONFIGURED",
        503,
        "Delta API credentials are not configured on the gateway."
      );
    }
    const timestamp = nowSeconds();
    return buildAuthHeaders(credentials.apiKey, credentials.apiSecret, {
      method,
      path,
      query,
      body,
      timestamp,
    });
  }

  /**
   * One HTTP attempt. Returns the parsed response for ANY status code that
   * Delta returns — interpreting the status is the caller's job, because a 4xx
   * on an order means something very different from a 5xx.
   */
  private async attempt(
    method: DeltaMethod,
    path: string,
    query: Record<string, QueryValue>,
    body: string,
    auth: boolean,
    attemptNumber: number
  ): Promise<DeltaResult> {
    const url = buildUrl(this.options.baseUrl, path, query);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "trading-command-gateway/1.0",
    };
    if (auth) Object.assign(headers, this.authHeaders(method, path, query, body));

    this.options.onRequest?.({ method, path, authenticated: auth, attempt: attemptNumber });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === "" ? undefined : body,
        signal: controller.signal,
      });
      const text = await response.text();
      let json: unknown = null;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return { status: response.status, json, durationMs: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Read-only request. Retries network failures, timeouts, 429 and 5xx with a
   * short backoff — safe because a GET has no side effect on the exchange.
   */
  async get<T = unknown>(
    path: string,
    query: Record<string, QueryValue> = {},
    options: { auth?: boolean; timeoutMs?: number } = {}
  ): Promise<DeltaResult<T>> {
    const auth = options.auth ?? true;
    const attempts = this.options.maxRetries + 1;
    let lastError: unknown;

    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(Math.min(250 * 2 ** (i - 1), 1500));
      try {
        const result = await this.attempt("GET", path, query, "", auth, i + 1);
        const retryable =
          result.status === 429 || result.status === 408 || result.status >= 500;
        if (retryable && i < attempts - 1) {
          lastError = new GatewayError(
            result.status === 429 ? "DELTA_RATE_LIMITED" : "DELTA_UNAVAILABLE",
            result.status === 429 ? 429 : 502,
            `Delta answered HTTP ${result.status} on ${path}.`
          );
          continue;
        }
        return result as DeltaResult<T>;
      } catch (error) {
        lastError = error;
        const aborted = error instanceof Error && error.name === "AbortError";
        if (i < attempts - 1) continue;
        throw new GatewayError(
          aborted ? "DELTA_TIMEOUT" : "DELTA_UNAVAILABLE",
          aborted ? 504 : 502,
          aborted
            ? `Delta did not answer within ${this.options.timeoutMs} ms.`
            : "Could not reach Delta Exchange."
        );
      }
    }

    throw lastError instanceof GatewayError
      ? lastError
      : new GatewayError("DELTA_UNAVAILABLE", 502, "Could not reach Delta Exchange.");
  }

  /**
   * Mutating request (POST / PUT / DELETE). Exactly ONE attempt.
   *
   * Outcome classification:
   *   2xx                 -> accepted, return the response
   *   4xx (except 408/429) -> Delta rejected it; the order does NOT exist
   *   408 / 429 / 5xx      -> UNKNOWN: the exchange may have processed it
   *   network / timeout    -> UNKNOWN
   *
   * "UNKNOWN" always throws DELTA_UNKNOWN_RESULT so the caller records the
   * order as unreconciled and refuses to resubmit the same client order id.
   */
  async mutate<T = unknown>(
    method: Exclude<DeltaMethod, "GET">,
    path: string,
    body: unknown,
    options: { auth?: boolean } = {}
  ): Promise<DeltaResult<T>> {
    const auth = options.auth ?? true;
    const bodyString = body === undefined || body === null ? "" : JSON.stringify(body);

    let result: DeltaResult;
    try {
      result = await this.attempt(method, path, {}, bodyString, auth, 1);
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw deltaUnknownResult(
        aborted
          ? `Delta did not answer within ${this.options.timeoutMs} ms; the outcome of this ${method} ${path} is UNKNOWN.`
          : `The connection to Delta failed; the outcome of this ${method} ${path} is UNKNOWN.`,
        { method, path, reconcilable: true }
      );
    }

    const status = result.status;
    if (status === 408 || status === 429 || status >= 500) {
      throw deltaUnknownResult(
        `Delta answered HTTP ${status} on ${method} ${path}; the outcome is UNKNOWN and must be reconciled.`,
        { method, path, deltaStatus: status, reconcilable: true }
      );
    }

    return result as DeltaResult<T>;
  }

  /**
   * Normalise a non-2xx Delta response into a GatewayError whose code is
   * meaningful to the caller. `stage` is used in the message only.
   */
  static failure(
    stage: string,
    result: DeltaResult,
    extra: Record<string, string | number | boolean | null> = {}
  ): GatewayError {
    const { failed, code } = isDeltaFailureBody(result.json);
    const deltaCode = code ? ` (${code})` : "";
    const detail = {
      stage,
      deltaStatus: result.status,
      ...(code ? { deltaErrorCode: code } : {}),
      ...extra,
    };
    if (result.status === 401) {
      return new GatewayError(
        "DELTA_AUTH_ERROR",
        502,
        `Delta rejected the signature or API key during ${stage}${deltaCode}.`,
        detail
      );
    }
    if (result.status === 403) {
      return new GatewayError(
        "DELTA_FORBIDDEN",
        502,
        `Delta denied ${stage}${deltaCode}. Check the key's permissions and IP allowlist.`,
        detail
      );
    }
    if (result.status === 404) {
      return new GatewayError("DELTA_NOT_FOUND", 404, `Delta has no record for ${stage}${deltaCode}.`, detail);
    }
    if (result.status === 429) {
      return new GatewayError("DELTA_RATE_LIMITED", 429, `Delta rate-limited ${stage}${deltaCode}.`, detail);
    }
    return new GatewayError(
      "DELTA_API_ERROR",
      502,
      `Delta returned HTTP ${result.status} for ${stage}${failed ? deltaCode : ""}.`,
      detail
    );
  }

  /** Delta can answer 200/success:false (business error) — surface it safely. */
  assertSuccess(stage: string, result: DeltaResult, extra: Record<string, string | number | boolean | null> = {}): void {
    const { failed, code } = isDeltaFailureBody(result.json);
    if (result.status >= 400 || failed) throw DeltaClient.failure(stage, result, extra);
  }
}
