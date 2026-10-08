/**
 * Gateway authentication primitives.
 *
 * The Vercel application — and only the Vercel application — authenticates to
 * this gateway with
 *
 *   Authorization: Bearer <TRADING_GATEWAY_SECRET>
 *
 * The browser never holds or sends this secret; it reaches the gateway only
 * through server-side Vercel code (see `src/lib/tradingGateway/client.ts`).
 *
 * This module holds the *mechanics* of credential checking (parsing and
 * constant-time comparison). The request-pipeline *policy* — when to answer
 * 503 instead of 401, and how the failure is surfaced to the caller — lives in
 * `src/middleware/authentication.ts`.
 */
import crypto from "node:crypto";

/**
 * Constant-time string comparison.
 *
 * Both inputs are hashed first, so the comparison itself operates on uniform
 * 32-byte digests: neither the secret's value nor its length can be inferred
 * from response timing. `crypto.timingSafeEqual` additionally requires equal
 * lengths, which the digests always satisfy.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const da = crypto.createHash("sha256").update(a, "utf8").digest();
  const db = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(da, db);
}

/** Extract the bearer token from an Authorization header value, if present. */
export function bearerFrom(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1]!.trim() : null;
}

/** True when the gateway has a secret to compare against. */
export function gatewaySecretConfigured(gatewaySecret: string | undefined | null): boolean {
  return typeof gatewaySecret === "string" && gatewaySecret.length > 0;
}

/**
 * Constant-time check of a presented bearer token against the configured
 * secret. An empty secret is never accepted — callers must run
 * `gatewaySecretConfigured` first so the failure is reported as 503 (gateway
 * not configured) rather than as an authentication failure.
 */
export function authenticateGatewayCaller(
  presented: string | null,
  gatewaySecret: string
): boolean {
  if (!gatewaySecretConfigured(gatewaySecret)) return false;
  if (!presented) return false;
  return constantTimeEqual(presented, gatewaySecret);
}
