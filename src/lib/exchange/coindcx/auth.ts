/**
 * CoinDCX authentication.
 *
 * Verified against the official API reference (docs.coindcx.com), NOT derived
 * from the Delta implementation — the two schemes are different:
 *
 *   Delta:    HMAC_SHA256(secret, METHOD + timestamp + path + query + body)
 *             headers: api-key, timestamp, signature
 *
 *   CoinDCX:  HMAC_SHA256(secret, <the exact JSON body sent>)
 *             headers: X-AUTH-APIKEY, X-AUTH-SIGNATURE, Content-Type
 *             the timestamp lives INSIDE the body, and orders whose timestamp
 *             is more than 10 seconds old are rejected.
 *
 * Consequences that shape this module:
 *
 *   1. The signature covers the raw body bytes, so the body must be serialised
 *      ONCE and both signed and sent. `serializeBody` is that single point.
 *   2. CoinDCX's own samples use `JSON.stringify` (compact, no spaces) and the
 *      Python samples replicate it with `separators=(',', ':')`. We therefore
 *      emit compact JSON.
 *   3. Timestamps are milliseconds in every official sample (`Date.now()`),
 *      although the comments say "seconds". Milliseconds are what the samples
 *      actually send, so milliseconds are what we send.
 *   4. There is NO client order id on CoinDCX futures. Idempotency is ours
 *      (see src/app/api/orders/route.ts) — never a venue field.
 *
 * Everything here is pure and offline: it is covered by deterministic vectors
 * in tests/coindcx-signing.test.mjs.
 */
import crypto from "node:crypto";

export interface CoinDcxSignedRequest {
  /** Exact bytes that will be PUT ON THE WIRE as the body. */
  body: string;
  /** Value for X-AUTH-SIGNATURE. */
  signature: string;
}

/** Compact JSON, matching CoinDCX's own samples (no whitespace). */
export function serializeBody(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

/** hex(HMAC_SHA256(apiSecret, body)) — exactly what CoinDCX verifies. */
export function signBody(apiSecret: string, body: string): string {
  return crypto.createHmac("sha256", apiSecret).update(body, "utf8").digest("hex");
}

/**
 * Sign a payload.
 *
 * CoinDCX wants the timestamp INSIDE the body, and rejects an order whose
 * timestamp is more than 10 seconds old — so the signer always writes it last
 * and a caller-supplied `timestamp` can never override it. The returned `body`
 * is the exact string that must be sent; signing anything else invalidates the
 * signature.
 */
export function signPayload(
  apiSecret: string,
  payload: Record<string, unknown> = {},
  now: number = Date.now()
): CoinDcxSignedRequest {
  const withTimestamp = { ...payload, timestamp: now };
  const body = serializeBody(withTimestamp);
  return { body, signature: signBody(apiSecret, body) };
}

/** Headers CoinDCX requires on every private endpoint. */
export function authHeaders(apiKey: string, signature: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-AUTH-APIKEY": apiKey,
    "X-AUTH-SIGNATURE": signature,
  };
}

/**
 * Millisecond epoch. Every official CoinDCX sample sends `Date.now()`; the
 * venue rejects order requests whose timestamp is older than 10 seconds, so
 * this must never be cached across calls.
 */
export function nowMillis(now: number = Date.now()): number {
  return now;
}

/** Are both credentials present? An unconfigured venue must fail closed. */
export function hasCredentials(apiKey: string | undefined, apiSecret: string | undefined): boolean {
  return Boolean(apiKey && apiSecret);
}

/**
 * Constant-time comparison used by the deployment self-check (comparing a
 * computed signature against an expected one in tests/diagnostics).
 */
export function signaturesMatch(a: string, b: string): boolean {
  const da = crypto.createHash("sha256").update(a, "utf8").digest();
  const db = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(da, db);
}
