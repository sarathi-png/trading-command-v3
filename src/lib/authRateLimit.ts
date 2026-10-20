/**
 * Best-effort throttle for failed operator logins.
 *
 * `API_PASSWORD` is a single shared credential that can place orders, so the
 * login endpoints must not be an unlimited password oracle. This counter is a
 * fixed window per client address: enough failures inside the window and the
 * caller is refused with 429 until the window expires.
 *
 * SCOPE: in-process memory only. Vercel may run several instances, so the real
 * guarantee stays "a long random API_PASSWORD". This removes the trivial
 * unlimited-rate attack, not every distributed one. State is intentionally not
 * persisted: a restart clearing the counters is preferable to a lockout table
 * that can itself be abused to lock the operator out.
 *
 * A successful login always clears the window for that client, so a typo
 * followed by the correct password never accumulates toward a lockout.
 */

/** How long a failure window lasts. */
export const AUTH_THROTTLE_WINDOW_MS = 15 * 60_000;

/** Failures allowed inside one window before the caller is refused. */
export const AUTH_MAX_FAILURES = 10;

/** Largest accepted credential body. Login payloads are tiny. */
export const MAX_AUTH_BODY_BYTES = 4 * 1024;

/** Upper bound on tracked clients; oldest entries are dropped beyond this. */
const MAX_TRACKED_CLIENTS = 1000;

interface FailureWindow {
  count: number;
  resetAt: number;
}

const failures = new Map<string, FailureWindow>();

/**
 * Identify the caller for throttling.
 *
 * On Vercel `x-forwarded-for` is set by the platform. The header is only a
 * bucketing key, never an authorization input, so a spoofed value can dodge a
 * limit but cannot gain access.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const candidate =
    forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "";
  return candidate || "unknown";
}

/** True when this client must wait before trying another password. */
export function isThrottled(key: string, now: number = Date.now()): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.resetAt <= now) {
    failures.delete(key);
    return false;
  }
  return entry.count >= AUTH_MAX_FAILURES;
}

/** Whole seconds until the window resets, for the `Retry-After` header. */
export function retryAfterSeconds(key: string, now: number = Date.now()): number {
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) return 0;
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
}

/** Count one failed attempt. Successful logins never call this. */
export function recordAuthFailure(key: string, now: number = Date.now()): void {
  const entry = failures.get(key);
  if (!entry || entry.resetAt <= now) {
    prune(now);
    failures.set(key, { count: 1, resetAt: now + AUTH_THROTTLE_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

/** A correct password clears the client's window. */
export function clearAuthFailures(key: string): void {
  failures.delete(key);
}

/** Test hook. Not called by application code. */
export function resetAuthThrottle(): void {
  failures.clear();
}

/** Reject oversized bodies before parsing them. */
export function bodyTooLarge(req: Request): boolean {
  const raw = req.headers.get("content-length");
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > MAX_AUTH_BODY_BYTES;
}

function prune(now: number): void {
  if (failures.size < MAX_TRACKED_CLIENTS) return;
  for (const [key, entry] of failures) {
    if (entry.resetAt <= now) failures.delete(key);
  }
  // Map preserves insertion order, so the first key is the oldest window.
  while (failures.size >= MAX_TRACKED_CLIENTS) {
    const oldest = failures.keys().next().value;
    if (oldest === undefined) break;
    failures.delete(oldest);
  }
}
