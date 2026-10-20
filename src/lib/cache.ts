/**
 * Small TTL cache with single-flight de-duplication.
 *
 * Every workstation panel polls, and several panels ask for the same ticker,
 * candle set or macro series in the same second. Without this, one page load
 * fans out into dozens of identical upstream requests and risks a rate limit.
 *
 * Rules:
 *   - only successful results are cached (errors always propagate fresh);
 *   - concurrent misses for the same key share one in-flight promise;
 *   - the map is bounded so a symbol/timeframe spray cannot leak memory.
 */
const MAX_ENTRIES = 500;

type Entry = { expiresAt: number; value: unknown };
const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = load()
    .then((value) => {
      store.set(key, { expiresAt: Date.now() + ttlMs, value });
      evictIfNeeded();
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

/** Test/ops helper. Prefix-based clearing keeps namespaces independent. */
export function clearCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    inflight.clear();
    return;
  }
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
  for (const key of inflight.keys()) if (key.startsWith(prefix)) inflight.delete(key);
}
