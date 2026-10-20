/**
 * Best-effort, in-process sliding-window rate limiter.
 *
 * Honest caveat, stated once here: a Vercel deployment may run more
 * than one serverless instance, and an in-process counter cannot see
 * across instances. This limiter therefore bounds a single instance's
 * request rate (enough to stop a runaway polling loop or a double-click
 * storm) — it is NOT a distributed quota. The durable, cross-instance
 * guard for AI spend is the free-tier budget ledger in
 * src/lib/ai/store.ts, which is why this module exists only as a
 * first line of defence, not as the only one.
 */
interface Window {
  timestamps: number[];
}

const windows = new Map<string, Window>();
/** Bound memory: prune keys not touched recently. */
const MAX_KEYS = 4096;

export function rateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (windows.size > MAX_KEYS) {
    for (const k of windows.keys()) {
      const w = windows.get(k);
      if (!w || !w.timestamps.length || now - w.timestamps[w.timestamps.length - 1] > windowMs * 4) {
        windows.delete(k);
      }
    }
  }
  let win = windows.get(key);
  if (!win) {
    win = { timestamps: [] };
    windows.set(key, win);
  }
  // Drop entries outside the current window.
  win.timestamps = win.timestamps.filter((t) => now - t < windowMs);
  if (win.timestamps.length >= limit) return true; // limited
  win.timestamps.push(now);
  return false;
}
