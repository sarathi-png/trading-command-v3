import { createHash } from "node:crypto";
import { AI_PROVIDER_CATALOG, type AiProviderId } from "./types";

type Provider = Exclude<AiProviderId, "rules">;
export interface FreeModel { id: string; name: string; contextLength: number; structured: boolean }
export function freeModels(payload: unknown): FreeModel[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { data?: unknown }).data;
  if (!Array.isArray(rows)) return [];
  const unique = new Map<string, FreeModel>();
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || !row.pricing || typeof row.pricing !== "object") continue;
    const pricing = row.pricing;
    // A suffix or a public model listing is not evidence that the request is free.
    if (pricing.prompt == null || pricing.completion == null) continue;
    if (!Object.values(pricing).every(v => (typeof v === "string" || typeof v === "number") && String(v).trim() !== "" && Number(v) === 0)) continue;
    if (row.architecture?.output_modalities && !row.architecture.output_modalities.includes("text")) continue;
    if (!Number.isFinite(Number(row.context_length)) || Number(row.context_length ?? 0) < 4096) continue;
    // Skip pre-release "preview" models. In live testing these did not return a
    // usable chat completion for signals: reasoning-only previews left the final
    // `content` field empty (only chain-of-thought in `reasoning`), and the
    // lyria-*-preview entries are music models that reject a chat request
    // (HTTP 400). They sort to the top (structured + huge context cap) and were
    // the primary cause of the "No JSON object in model response" fallback.
    if (row.id.toLowerCase().includes("preview")) continue;
    unique.set(row.id, { id: row.id, name: typeof row.name === "string" ? row.name : row.id,
      contextLength: Number(row.context_length), structured: Array.isArray(row.supported_parameters) && row.supported_parameters.includes("response_format") });
  }
  // Compatibility ranking, not an unsubstantiated claim about prediction accuracy.
  return [...unique.values()].sort((a, b) => Number(b.structured) - Number(a.structured) || Math.min(b.contextLength, 131072) - Math.min(a.contextLength, 131072) || a.id.localeCompare(b.id));
}
const catalogCache = new Map<string, { expires: number; models: FreeModel[] }>();
export function modelCacheKey(provider: Provider, key: string) { return `${provider}:${createHash("sha256").update(key).digest("hex")}`; }
export async function discoverFreeModels(provider: Provider, apiKey: string, fetchImpl: typeof fetch = fetch, refresh = false): Promise<FreeModel[]> {
  const key = modelCacheKey(provider, apiKey);
  const cached = catalogCache.get(key);
  if (!refresh && cached && cached.expires > Date.now()) return cached.models;
  const response = await fetchImpl(AI_PROVIDER_CATALOG[provider].baseUrl.replace(/chat\/completions$/, "models"), {
    headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(8000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Model discovery failed (HTTP ${response.status}).`);
  const models = freeModels(await response.json());
  if (catalogCache.size > 64) catalogCache.clear();
  catalogCache.set(key, { models, expires: Date.now() + 5 * 60_000 });
  return models;
}
