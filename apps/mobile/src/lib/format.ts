/**
 * Display formatting.
 *
 * Rule: a missing or non-finite value renders as "unavailable". It is never
 * coerced to 0, because a fabricated zero on a trading screen looks like a real
 * quote.
 */

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function groupThousands(fixed: string): string {
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const [whole, fraction] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** A value that rounds to zero must not render as "-0.00". */
function normalizeZero(fixed: string): string {
  return /^-0(?:\.0+)?$/.test(fixed) ? fixed.slice(1) : fixed;
}

export function formatNumber(value: unknown, digits = 2): string {
  if (!isFiniteNumber(value)) return "unavailable";
  return groupThousands(normalizeZero(value.toFixed(digits)));
}

/** Crypto prices need more precision below 1 than above 1000. */
export function priceDigits(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude >= 1) return 2;
  if (magnitude >= 0.01) return 4;
  return 6;
}

export function formatPrice(value: unknown): string {
  if (!isFiniteNumber(value)) return "unavailable";
  return formatNumber(value, priceDigits(value));
}

export function formatMoney(
  value: unknown,
  currency: "usd" | "inr" = "usd",
  digits = 2
): string {
  if (!isFiniteNumber(value)) return "unavailable";
  const symbol = currency === "inr" ? "₹" : "$";
  const formatted = formatNumber(value, digits);
  return formatted.startsWith("-") ? `-${symbol}${formatted.slice(1)}` : `${symbol}${formatted}`;
}

export function formatSignedMoney(
  value: unknown,
  currency: "usd" | "inr" = "usd",
  digits = 2
): string {
  if (!isFiniteNumber(value)) return "unavailable";
  const formatted = formatMoney(value, currency, digits);
  return value > 0 ? `+${formatted}` : formatted;
}

export function formatPct(value: unknown, digits = 2): string {
  if (!isFiniteNumber(value)) return "unavailable";
  const fixed = `${normalizeZero(value.toFixed(digits))}%`;
  return value > 0 ? `+${fixed}` : fixed;
}

export function formatQty(value: unknown): string {
  if (!isFiniteNumber(value)) return "unavailable";
  const fixed = value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return fixed || "0";
}

/** Human age of an ISO timestamp. Invalid or missing input is "unavailable". */
export function formatAge(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "unavailable";
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "unavailable";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Provider freshness label. Never says "live" for a stale or missing snapshot.
 */
export function stalenessLabel(
  stale: boolean | undefined,
  asOf: string | null | undefined,
  now = Date.now()
): string {
  if (!asOf) return "AS OF UNAVAILABLE";
  const age = formatAge(asOf, now);
  if (stale) return `STALE · ${age}`;
  return `FRESH · ${age}`;
}

/** Compact status text for a signal age. */
export function signalAge(createdAt: string, now = Date.now()): string {
  return formatAge(createdAt, now);
}

/**
 * UTC clock for a real timestamp. The home screen shows the provider's `asOf`
 * explicitly instead of only an age, so a stale snapshot cannot look fresh.
 */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "unavailable";
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "unavailable";
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}
