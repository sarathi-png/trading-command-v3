import { getRepo } from "@/lib/repo";
import type { AppSettings } from "./types";

import { DEFAULT_SETTINGS } from "./settingsDefaults";
export { DEFAULT_SETTINGS } from "./settingsDefaults";

const KEY = "app";
let cache: { at: number; value: AppSettings } | null = null;
const CACHE_MS = 5000;

function merge(base: AppSettings, patch: Partial<AppSettings>): AppSettings {
  return {
    ...base,
    ...patch,
    modules: { ...base.modules, ...(patch.modules ?? {}) },
    strategiesEnabled: { ...base.strategiesEnabled, ...(patch.strategiesEnabled ?? {}) },
    riskLimits: { ...base.riskLimits, ...(patch.riskLimits ?? {}) },
    watchlist: patch.watchlist ?? base.watchlist,
  };
}

export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  // A failed database read must not masquerade as first-run defaults: doing so
  // can make onboarding reappear and conceal an unapplied database schema.
  const stored = (await (await getRepo()).getSetting(KEY)) as (Partial<AppSettings> & { dataSource?: string }) | null;
  const value = stored ? merge(DEFAULT_SETTINGS, stored) : { ...DEFAULT_SETTINGS };
  // Pre-migration rows stored the venue as the data source ("delta"). The value
  // now means "a real venue", so map it forward instead of silently dropping a
  // user back to demo data.
  if ((value.dataSource as string) === "delta") value.dataSource = "live";
  cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = merge(current, patch);
  // This is the write the onboarding overlay depends on: it must persist, or
  // `onboarded` stays false and the full-screen overlay never clears.
  await (await getRepo()).saveSetting(KEY, next);
  cache = { at: Date.now(), value: next };
  return next;
}

export function invalidateSettingsCache() {
  cache = null;
}

/** Append an entry to the audit log. Never include secrets in detail. */
export async function logAudit(event: string, detail: Record<string, unknown> = {}) {
  try {
    await (await getRepo()).appendAudit(event, detail);
  } catch {
    /* audit logging must never break the request path */
  }
}
