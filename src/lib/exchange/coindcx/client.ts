/**
 * CoinDCX HTTP transport.
 *
 * This is the ONLY module that talks to CoinDCX over the network. Everything
 * else in the app goes through the exchange facade in `../service.ts`.
 *
 * Design rules, inherited from the (removed) gateway client because they are
 * sound regardless of venue:
 *
 *   - READ vs MUTATE is explicit at the call site. Reads retry with backoff;
 *     mutations are attempted EXACTLY ONCE.
 *   - A mutation that ends without a definitive answer throws
 *     EXCHANGE_UNKNOWN_RESULT. The caller must reconcile (list orders) before
 *     anything is retried. CoinDCX has no client-order-id, so this is the only
 *     thing standing between a dropped response and a duplicate position.
 *   - Every failure is normalised into ExchangeError with a code that is safe
 *     to branch on and a message that is safe to display.
 *   - Secrets never enter a message, a log line or an error detail.
 */
import { ExchangeError } from "../errors";
import { authHeaders, hasCredentials, signPayload } from "./auth";

export interface CoinDcxCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface CoinDcxClientOptions {
  /** https://api.coindcx.com — private + some public futures data. */
  baseUrl: string;
  /** https://public.coindcx.com — candlesticks, order book depth. */
  publicBaseUrl: string;
  credentials: CoinDcxCredentials | null;
  timeoutMs?: number;
  maxReadRetries?: number;
  exchange?: string;
  /** Test/observability hook. Never receives headers or bodies. */
  onRequest?: (info: { method: string; path: string; attempt: number; authenticated: boolean }) => void;
}

interface RawResult {
  status: number;
  json: unknown;
  /** Raw text, truncated, only for diagnostics on unparseable answers. */
  text: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_READ_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Truncate a venue answer for diagnostics without dumping a whole payload. */
function snippet(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export class CoinDcxClient {
  constructor(private readonly options: CoinDcxClientOptions) {}

  get configured(): boolean {
    return Boolean(this.options.credentials);
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private get maxReadRetries(): number {
    return this.options.maxReadRetries ?? DEFAULT_MAX_READ_RETRIES;
  }

  private credentialsOrFail(path: string): CoinDcxCredentials {
    const credentials = this.options.credentials;
    if (!credentials || !hasCredentials(credentials.apiKey, credentials.apiSecret)) {
      throw new ExchangeError(
        "CoinDCX API credentials are not configured on this deployment, so private account data is unavailable.",
        "EXCHANGE_NOT_CONFIGURED",
        503,
        { exchange: this.options.exchange ?? "coindcx", path }
      );
    }
    return credentials;
  }

  /**
   * One HTTP attempt. Returns the parsed response for ANY status the venue
   * sends — interpreting the status is the caller's job, because a 400 on an
   * order means something very different from a 500.
   */
  private async attempt(input: {
    method: "GET" | "POST";
    url: string;
    path: string;
    body?: string;
    headers: Record<string, string>;
    attempt: number;
    authenticated: boolean;
  }): Promise<RawResult> {
    this.options.onRequest?.({
      method: input.method,
      path: input.path,
      attempt: input.attempt,
      authenticated: input.authenticated,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        // CoinDCX private endpoints are POST (even for reads) and reject a
        // request whose signature does not cover the exact body bytes.
        ...(input.body === undefined ? {} : { body: input.body }),
        signal: controller.signal,
        cache: "no-store",
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
      return { status: response.status, json, text, durationMs: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Map a venue answer to an ExchangeError. `mutation` decides whether a
   * non-definitive failure is "unknown" (must reconcile) or retryable.
   */
  private failure(input: {
    path: string;
    status: number;
    json: unknown;
    text: string;
    mutation: boolean;
  }): ExchangeError {
    const detail = { exchange: this.options.exchange ?? "coindcx", path: input.path, status: input.status };
    const body = (input.json ?? {}) as Record<string, unknown>;
    const venueMessage =
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : Array.isArray(body.errors)
            ? snippet(JSON.stringify(body.errors))
            : undefined;
    const withVenue = { ...detail, ...(venueMessage ? { venueCode: snippet(venueMessage) } : {}) };

    if (input.status === 401 || input.status === 403) {
      // CoinDCX uses 401 for an invalid/expired key or signature and for a
      // request from an IP the key is bound to. Both are operator-fixable.
      return new ExchangeError(
        `CoinDCX rejected the API key or signature on ${input.path}. Check COINDCX_API_KEY/COINDCX_API_SECRET` +
          (input.status === 403 ? " and the key's IP binding." : "."),
        input.status === 403 ? "EXCHANGE_FORBIDDEN" : "EXCHANGE_AUTH_ERROR",
        502,
        withVenue
      );
    }
    if (input.status === 404) {
      return new ExchangeError(`CoinDCX has no record for ${input.path}.`, "EXCHANGE_NOT_FOUND", 404, withVenue);
    }
    if (input.status === 429) {
      // A throttled WRITE has an unknown outcome only if it was actually
      // processed; CoinDCX rejects before processing when throttling, but we
      // still refuse to guess — the order path reconciles.
      return input.mutation
        ? new ExchangeError(
            `CoinDCX rate-limited ${input.path}; the order outcome is unknown — reconcile before retrying.`,
            "EXCHANGE_UNKNOWN_RESULT",
            429,
            { ...withVenue, reconcilable: true }
          )
        : new ExchangeError(`CoinDCX rate-limited ${input.path}.`, "EXCHANGE_RATE_LIMITED", 429, withVenue);
    }
    if (input.status >= 500) {
      return input.mutation
        ? new ExchangeError(
            `CoinDCX answered HTTP ${input.status} on ${input.path}; the order outcome is unknown — reconcile before retrying.`,
            "EXCHANGE_UNKNOWN_RESULT",
            502,
            { ...withVenue, reconcilable: true }
          )
        : new ExchangeError(`CoinDCX is unavailable (HTTP ${input.status}) for ${input.path}.`, "EXCHANGE_API_ERROR", 502, withVenue);
    }
    if (input.status >= 400) {
      // 4xx = the venue answered and refused. Nothing was created.
      return new ExchangeError(
        venueMessage
          ? `CoinDCX rejected ${input.path}: ${snippet(venueMessage)}`
          : `CoinDCX rejected ${input.path} (HTTP ${input.status}).`,
        "EXCHANGE_BAD_REQUEST",
        400,
        withVenue
      );
    }
    return new ExchangeError(
      `CoinDCX returned HTTP ${input.status} for ${input.path}.`,
      "EXCHANGE_API_ERROR",
      502,
      { ...withVenue, response: snippet(input.text) }
    );
  }

  /** Low-level request. Not exported: callers use read()/mutate(). */
  private async request<T>(input: {
    method: "GET" | "POST";
    path: string;
    payload?: Record<string, unknown>;
    /** Absolute URL override (public.coindcx.com endpoints). */
    absoluteUrl?: string;
    authenticated: boolean;
    mutation: boolean;
  }): Promise<T> {
    const credentials = input.authenticated ? this.credentialsOrFail(input.path) : null;
    const attempts = input.mutation ? 1 : 1 + this.maxReadRetries;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(Math.min(250 * 2 ** (attempt - 1), 1500));

      let body: string | undefined;
      let headers: Record<string, string> = { Accept: "application/json" };
      if (credentials) {
        // Signed once, sent verbatim: the signature covers these exact bytes.
        const signed = signPayload(credentials.apiSecret, input.payload ?? {});
        body = signed.body;
        headers = { ...headers, ...authHeaders(credentials.apiKey, signed.signature) };
      }

      const url = input.absoluteUrl ?? `${this.options.baseUrl.replace(/\/+$/, "")}${input.path}`;

      let result: RawResult;
      try {
        result = await this.attempt({
          method: input.method,
          url,
          path: input.path,
          ...(body === undefined ? {} : { body }),
          headers,
          attempt: attempt + 1,
          authenticated: Boolean(credentials),
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        lastError = input.mutation
          ? new ExchangeError(
              `CoinDCX did not answer ${input.path} within ${this.timeoutMs} ms; the order outcome is unknown — reconcile before retrying.`,
              "EXCHANGE_UNKNOWN_RESULT",
              504,
              { exchange: this.options.exchange ?? "coindcx", path: input.path, reconcilable: true }
            )
          : new ExchangeError(
              aborted
                ? `CoinDCX did not answer ${input.path} within ${this.timeoutMs} ms.`
                : `Could not reach CoinDCX for ${input.path}.`,
              aborted ? "EXCHANGE_TIMEOUT" : "EXCHANGE_UNAVAILABLE",
              aborted ? 504 : 502,
              { exchange: this.options.exchange ?? "coindcx", path: input.path }
            );
        // Retry only safe reads; a mutation stops here.
        if (!input.mutation && attempt < attempts - 1) continue;
        throw lastError;
      }

      const retryableRead =
        !input.mutation &&
        (result.status === 429 || result.status === 408 || result.status >= 500) &&
        attempt < attempts - 1;
      if (retryableRead) {
        lastError = this.failure({
          path: input.path,
          status: result.status,
          json: result.json,
          text: result.text,
          mutation: false,
        });
        continue;
      }

      if (result.status >= 400) {
        throw this.failure({
          path: input.path,
          status: result.status,
          json: result.json,
          text: result.text,
          mutation: input.mutation,
        });
      }
      if (result.json === null) {
        throw new ExchangeError(
          `CoinDCX returned a response that could not be parsed for ${input.path}.`,
          "EXCHANGE_API_ERROR",
          502,
          { exchange: this.options.exchange ?? "coindcx", path: input.path, response: snippet(result.text) }
        );
      }
      return result.json as T;
    }

    throw lastError instanceof ExchangeError
      ? lastError
      : new ExchangeError(`CoinDCX request failed for ${input.path}.`, "EXCHANGE_UNAVAILABLE", 502);
  }

  /**
   * Authenticated read. CoinDCX serves most private reads over POST with a
   * signed JSON body; retrying is safe because the operation has no side
   * effect.
   */
  async read<T = unknown>(path: string, payload: Record<string, unknown> = {}, method: "GET" | "POST" = "POST"): Promise<T> {
    return this.request<T>({ method, path, payload, authenticated: true, mutation: false });
  }

  /** Authenticated mutation. Exactly one attempt — never auto-retried. */
  async mutate<T = unknown>(path: string, payload: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>({ method: "POST", path, payload, authenticated: true, mutation: true });
  }

  /** Unauthenticated read against api.coindcx.com. Safe to retry. */
  async publicRead<T = unknown>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const search = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join("&");
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}${path}${search ? `?${search}` : ""}`;
    return this.request<T>({
      method: "GET",
      path: search ? `${path}?${search}` : path,
      absoluteUrl: url,
      authenticated: false,
      mutation: false,
    });
  }

  /** Unauthenticated read against public.coindcx.com. Safe to retry. */
  async publicDataRead<T = unknown>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const search = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
      .join("&");
    const url = `${this.options.publicBaseUrl.replace(/\/+$/, "")}${path}${search ? `?${search}` : ""}`;
    return this.request<T>({
      method: "GET",
      path: search ? `${path}?${search}` : path,
      absoluteUrl: url,
      authenticated: false,
      mutation: false,
    });
  }
}
