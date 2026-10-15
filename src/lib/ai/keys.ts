/**
 * API-key resolution for the AI providers.
 *
 * Precedence: environment variables win, then `data/ai-keys.json` (written from
 * the Settings screen so a key can be pasted without editing files). The keys
 * live only on the server: no route ever returns a key, and the status object
 * carries at most a 4-character hint so the user can confirm *which* key is
 * loaded without exposing it.
 *
 * Free-tier reality: these keys are the user's own, limited-quota credentials.
 * Nothing here spends money, and an unconfigured provider simply means the
 * built-in rule engine answers instead (see `service.ts`).
 */
import { readDoc, writeDoc } from "../fileStore";
import { AI_PROVIDER_CATALOG, type AiProviderId } from "./types";

const DOC = "ai-keys.json";
/** Which provider's key file the settings screen is allowed to read back. */
interface AiKeyDoc {
  openrouter?: { key?: string; model?: string };
  nvidia?: { key?: string; model?: string };
}

export interface ResolvedKey {
  key: string | null;
  source: "env" | "file" | null;
  hint: string | null;
  model: string;
}

function hintOf(key: string): string | null {
  const last4 = key.slice(-4);
  return last4.length === 4 ? `…${last4}` : null;
}

export function resolveKey(provider: Exclude<AiProviderId, "rules">): ResolvedKey {
  const catalog = AI_PROVIDER_CATALOG[provider];
  const doc = readDoc<AiKeyDoc>(DOC, {});
  const envModel = process.env[catalog.modelEnv]?.trim() || "";

  for (const envName of catalog.keyEnv) {
    const value = process.env[envName];
    if (value && value.trim()) {
      return {
        key: value.trim(),
        source: "env",
        hint: hintOf(value.trim()),
        model: envModel || catalog.defaultModel,
      };
    }
  }

  const stored = doc[provider];
  if (stored?.key && stored.key.trim()) {
    const key = stored.key.trim();
    return {
      key,
      source: "file",
      hint: hintOf(key),
      model: envModel || stored.model?.trim() || catalog.defaultModel,
    };
  }

  return { key: null, source: null, hint: null, model: envModel || stored?.model?.trim() || catalog.defaultModel };
}

/** Model currently in use for a provider (key present or not). */
export function modelFor(provider: Exclude<AiProviderId, "rules">): string {
  return resolveKey(provider).model;
}

/** Public status — never contains a key. */
export function keyStatus(): Record<Exclude<AiProviderId, "rules">, { configured: boolean; keySource: "env" | "file" | null; keyHint: string | null; model: string; envNames: string[]; docsUrl: string }> {
  const out = {} as Record<Exclude<AiProviderId, "rules">, { configured: boolean; keySource: "env" | "file" | null; keyHint: string | null; model: string; envNames: string[]; docsUrl: string }>;
  for (const id of ["openrouter", "nvidia"] as const) {
    const resolved = resolveKey(id);
    out[id] = {
      configured: Boolean(resolved.key),
      keySource: resolved.source,
      keyHint: resolved.hint,
      model: resolved.model,
      envNames: AI_PROVIDER_CATALOG[id].keyEnv,
      docsUrl: AI_PROVIDER_CATALOG[id].docsUrl,
    };
  }
  return out;
}

export interface SaveKeyInput {
  provider: Exclude<AiProviderId, "rules">;
  key?: string | null;
  model?: string | null;
}

/**
 * Persist (or clear) a key. An empty key removes the stored entry so the
 * provider flips back to "not configured" instead of holding a blank string.
 * Returns the new public status.
 */
export async function saveKeys(input: SaveKeyInput[]): Promise<boolean> {
  const doc = readDoc<AiKeyDoc>(DOC, {});
  const next: AiKeyDoc = { ...doc };
  for (const item of input) {
    const existing = next[item.provider] ?? {};
    const model = item.model !== undefined && item.model !== null
      ? item.model.trim() || undefined
      : existing.model;
    const key = item.key === undefined ? existing.key : item.key?.trim() || undefined;
    if (!key && !model) delete next[item.provider];
    else next[item.provider] = { key, model };
  }
  return writeDoc(DOC, next);
}

/** Which providers have a usable key right now. */
export function configuredProviders(): Exclude<AiProviderId, "rules">[] {
  return (["openrouter", "nvidia"] as const).filter((id) => Boolean(resolveKey(id).key));
}
