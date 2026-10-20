/**
 * Deterministic signal ids.
 *
 * The webhook receives alerts over an at-least-once channel (TradingView may
 * deliver the same alert twice, and a serverless function may be retried), so
 * the signal needs an id derived from the alert rather than a fresh random one.
 * The primary key then provides dedupe across every instance, with no extra
 * column, index or migration.
 *
 * SHA-256 gives 128 bits after truncation, formatted as an RFC 4122 version-5
 * UUID so the value is a valid Postgres `uuid`. This is not a security boundary:
 * it is a naming function, and the webhook secret is the authorization control.
 */

const encoder = new TextEncoder();

/** Format 16 bytes as a canonical UUID with version 5 / RFC 4122 variant bits. */
function toUuid(bytes: Uint8Array): string {
  const copy = bytes.slice(0, 16);
  copy[6] = (copy[6] & 0x0f) | 0x50;
  copy[8] = (copy[8] & 0x3f) | 0x80;
  const hex = Array.from(copy, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable UUID for a given input string. Same input always yields the same id. */
export async function deterministicUuid(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return toUuid(new Uint8Array(digest));
}

/**
 * Stable id for a TradingView alert.
 *
 * Strategy is part of the key: two strategies alerting the same symbol/action
 * at the same millisecond are distinct signals.
 */
export function tradingViewSignalId(alert: {
  strategy: string;
  symbol: string;
  action: string;
  timestamp: number;
}): Promise<string> {
  return deterministicUuid(
    `tv:${alert.strategy}:${alert.symbol}:${alert.action}:${alert.timestamp}`
  );
}
