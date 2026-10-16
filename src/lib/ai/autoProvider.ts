import { discoverFreeModels, modelCacheKey } from "./models";
import { callProvider, type AiCallResult } from "./providers";
import { budgetState, recordCall } from "./store";
import type { AiContext, AiProviderId } from "./types";
const cooldowns = new Map<string, number>();
/** Every completion, including failed attempts, is charged to the local budget. */
export async function callFreeProvider(provider: Exclude<AiProviderId, "rules">, context: AiContext, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<AiCallResult> {
  const fail = (error: string): AiCallResult => ({ ok: false, kind: "not-configured", error, model: "auto-free", latencyMs: 0 });
  let models;
  try { models = await discoverFreeModels(provider, apiKey, fetchImpl); }
  catch { return fail("Could not verify the provider's current free-model catalog. Paid fallback is disabled."); }
  if (!models.length) return fail("No models with verifiable zero-cost pricing were returned by this provider. Trial credit is not proof of free eligibility. Using technical rules.");
  const eligible = models.filter(m => (cooldowns.get(`${modelCacheKey(provider, apiKey)}:${m.id}`) ?? 0) <= Date.now());
  if (!eligible.length) return fail("All verified free models are cooling down. Using technical rules.");
  const model = eligible[0];
  const budget = budgetState(provider);
  if (budget.blockedReason) return fail(budget.blockedReason);
  await recordCall(provider);
  const result = await callProvider(provider, context, { apiKey, model: model.id, fetchImpl });
  if (!result.ok && result.retryableModel) {
    cooldowns.set(`${modelCacheKey(provider, apiKey)}:${model.id}`, Date.now() + 15 * 60_000);
    if (cooldowns.size > 512) cooldowns.clear();
    return { ...result, error: `${result.error} Another verified free model will be selected after the provider request interval.` };
  }
  return result;
}
