/**
 * Delta Exchange India request signing (HMAC-SHA256).
 *
 * This is the ONLY place in the system where a Delta API secret is used. The
 * algorithm is the one Delta documents, and the one the application used
 * before this migration (src/lib/market/delta.ts):

 *   signature = HMAC_SHA256(
 *     api_secret,
 *     METHOD + timestamp + path + queryString + body
 *   )
 *
 *   - METHOD      upper-case HTTP method, e.g. "GET" / "POST" / "DELETE"
 *   - timestamp   unix time in SECONDS, as a string
 *   - path        the API path exactly as sent, e.g. "/v2/wallet/balances"
 *   - queryString "" when there is no query string, otherwise "?" + the
 *                 percent-encoded parameters exactly as they appear in the URL
 *   - body        the request body EXACTLY as sent (already-serialised JSON),
 *                 or "" when there is no body
 *
 * The signed string must equal the bytes on the wire. That is why the body is
 * serialised once and both signed and sent (`JSON.stringify` output is
 * byte-stable for a given object) instead of being built twice.
 *
 * Everything here is pure: no clock, no network, no environment. That is what
 * makes it testable with deterministic vectors (src/tests/signing.test.ts).
 */
import crypto from "node:crypto";

export type DeltaMethod = "GET" | "POST" | "PUT" | "DELETE";

export type QueryValue = string | number | boolean | undefined | null;

export interface SignedRequestInput {
  method: DeltaMethod;
  /** API path, no query string, e.g. "/v2/orders". */
  path: string;
  /** Query parameters. `undefined`/`null` values are dropped. */
  query?: Record<string, QueryValue>;
  /** Already-serialised request body, or "" for none. */
  body?: string;
  /** Unix seconds as a string. */
  timestamp: string;
}

/**
 * Percent-encoded query string WITHOUT the leading "?".
 *
 * Keys are left as-is (they are identifiers in Delta's API) and values are
 * encoded, matching the pre-existing implementation so existing behaviour is
 * preserved byte-for-byte.
 */
export function buildQueryString(query: Record<string, QueryValue> = {}): string {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
}

/** The exact string Delta expects to be HMAC'd. */
export function buildSignaturePayload(input: SignedRequestInput): string {
  const queryString = buildQueryString(input.query ?? {});
  return (
    input.method +
    input.timestamp +
    input.path +
    (queryString ? `?${queryString}` : "") +
    (input.body ?? "")
  );
}

/** Lower-case hex HMAC-SHA256 of the canonical payload. */
export function signRequest(apiSecret: string, input: SignedRequestInput): string {
  return crypto
    .createHmac("sha256", apiSecret)
    .update(buildSignaturePayload(input))
    .digest("hex");
}

/** The three headers Delta requires on private endpoints. */
export function buildAuthHeaders(
  apiKey: string,
  apiSecret: string,
  input: SignedRequestInput
): Record<string, string> {
  return {
    "api-key": apiKey,
    timestamp: input.timestamp,
    signature: signRequest(apiSecret, input),
  };
}

/** Unix seconds, as the string Delta wants in the `timestamp` header. */
export function nowSeconds(now: number = Date.now()): string {
  return Math.floor(now / 1000).toString();
}

/** Full request URL for a path + query, given the configured base URL. */
export function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>): string {
  const queryString = buildQueryString(query ?? {});
  return `${baseUrl.replace(/\/+$/, "")}${path}${queryString ? `?${queryString}` : ""}`;
}
