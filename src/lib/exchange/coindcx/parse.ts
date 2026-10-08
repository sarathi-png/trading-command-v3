/**
 * Shared parsing helpers for CoinDCX payloads.
 *
 * The important one is `expectArray`. Every list endpoint in this adapter
 * answers with a JSON array, and the difference between "the venue says there
 * are no rows" and "the venue answered something we do not understand" decides
 * whether the app is allowed to conclude anything at all:
 *
 *   - An empty ARRAY is a real answer: no positions, no orders, no trades.
 *   - Anything ELSE is not an answer. Treating it as empty would let the
 *     reconciler conclude "nothing was created" (and permit a retry), let the
 *     risk layer see an empty book, or let the daily-loss limit read zero.
 *
 * So a non-array payload throws, and every caller fails closed.
 */
import { ExchangeError } from "../errors";

export function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Assert that a venue answer is a list, or explain which endpoint misbehaved. */
export function expectArray<T>(payload: unknown, path: string): T[] {
  if (Array.isArray(payload)) return payload as T[];
  throw new ExchangeError(
    `CoinDCX returned a payload this build does not recognise for ${path} (expected a list). Refusing to interpret it as "no data".`,
    "EXCHANGE_API_ERROR",
    502,
    {
      exchange: "coindcx",
      path,
      responseShape: payload === null ? "null" : typeof payload,
    }
  );
}
