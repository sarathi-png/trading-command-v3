import { requestWorkspace } from "./workspace";
import { getRepo } from "@/lib/repo";
import type { AppSettings } from "./types";

import { DEFAULT_SETTINGS } from "./settingsDefaults";
export { DEFAULT_SETTINGS } from "./settingsDefaults";

const KEY = "app";
const caches = new Map<string, { at: number; value: AppSettings }>();
const CACHE_MS = 5000;

function merge(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return {
    ...base,
    ...patch,
    modules: { ...base.modules, ...(patch.modules ?? {}) },
    strategiesEnabled: { ...base.strategiesEnabled, ...(patch.strategiesEnabled ?? {}) },
    riskLimits: { ...base.riskLimits, ...(patch.riskLimits ?? {}) },
    // Legacy rows could contain `liveArmed: "yes"` from the pre-fix route.
    // Coerce on READ too, so an upgraded database cannot start armed without
    // the explicit boolean + confirmation token.
    liveArmed: (patch.liveArmed ?? base.liveArmed) === true,
    // Watchlists are user data, not reference data. Forcing knownSymbols()
    // here made every save a no-op and every read return all 20 venue pairs.
    watchlist: normalizeWatchlist(patch.watchlist ?? base.watchlist),
  };
}

/** Keep only strings, drop duplicates, and cap the list at a sane size. */
function normalizeWatchlist(list: unknown): string[] {
  if (!Array.isArray(list)) return [...DEFAULT_SETTINGS.watchlist];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const symbol = raw.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
    if (out.length >= 40) break;
  }
  return out.length > 0 ? out : [...DEFAULT_SETTINGS.watchlist];
}

export async function getSettings(): Promise<AppSettings> {
  const workspace = await requestWorkspace();
  const key = workspace ? `${KEY}:${workspace}` : KEY;
  const cache = caches.get(key);
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  // A failed database read must not masquerade as first-run defaults: doing so
  // can make onboarding reappear and conceal an unapplied database schema.
  let stored = (await (await getRepo()).getSetting(key)) as (Partial<AppSettings> & { dataSource?: string }) | null;
  if (!stored && workspace) {
    const legacy = await (await getRepo()).getSetting(KEY) as Partial<AppSettings> | null;
    if (legacy) stored = { ...legacy, liveArmed: false, mode: workspace, ...(workspace === "live" ? { dataSource: "live" as const } : {}) };
  }
  const value = stored ? merge(DEFAULT_SETTINGS, stored) : { ...DEFAULT_SETTINGS };
  // Pre-migration rows stored the venue as the data source ("delta"). The value
  // now means "a real venue", so map it forward instead of silently dropping a
  // user back to demo data.
  if ((value.dataSource as string) === "delta") value.dataSource = "live";
  if (workspace) { value.mode = workspace; if (workspace === "paper") value.liveArmed = false; }
  caches.set(key, { at: Date.now(), value });
  return value;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const workspace = await requestWorkspace();
  const key = workspace ? `${KEY}:${workspace}` : KEY;
  const next = merge(current, patch);
  if (workspace) { next.mode = workspace; if (workspace === "paper") next.liveArmed = false; }
  // This is the write the onboarding overlay depends on: it must persist, or
  // `onboarded` stays false and the full-screen overlay never clears.
  await (await getRepo()).saveSetting(key, next);
  caches.set(key, { at: Date.now(), value: next });
  return next;
}

export function invalidateSettingsCache() {
  caches.clear();
}

/** Append an entry to the audit log. Never include secrets in detail. */
export async function logAudit(event: string, detail: Record<string, unknown> = {}) {
  try {
    await (await getRepo()).appendAudit(event, detail);
  } catch {
    /* audit logging must never break the request path */
  }
}
