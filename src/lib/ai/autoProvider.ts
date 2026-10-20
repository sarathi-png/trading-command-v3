import { discoverFreeModels, modelCacheKey } from "./models";
import { callProvider, type AiCallResult } from "./providers";
import { budgetState, recordCall } from "./store";
import type { AiContext, AiProviderId } from "./types";
const cooldowns = new Map<string, number>();
/** Cap in-request model attempts so a flaky catalog cannot burn the whole day. */
const MAX_ATTEMPTS = 3;

/** Every completion, including failed attempts, is charged to the local budget. */
export async function callFreeProvider(
  provider: Exclude<AiProviderId, "rules">,
  context: AiContext,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  options?: { timeoutMs?: number; prompt?: { system: string; user: string } }
): Promise<AiCallResult> {
  const fail = (error: string): AiCallResult => ({ ok: false, kind: "not-configured", error, model: "auto-free", latencyMs: 0 });
  let models;
  try { models = await discoverFreeModels(provider, apiKey, fetchImpl); }
  catch { return fail("Could not verify the provider's current free-model catalog. Paid fallback is disabled."); }
  if (!models.length) return fail("No models with verifiable zero-cost pricing were returned by this provider. Trial credit is not proof of free eligibility. Using technical rules.");
  const cacheKey = modelCacheKey(provider, apiKey);
  const cool = (id: string) => {
    cooldowns.set(`${cacheKey}:${id}`, Date.now() + 15 * 60_000);
    if (cooldowns.size > 512) cooldowns.clear();
  };
  let lastModelIssue: AiCallResult | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const eligible = models.filter(m => (cooldowns.get(`${cacheKey}:${m.id}`) ?? 0) <= Date.now());
    if (!eligible.length) return lastModelIssue ?? fail("All verified free models are cooling down. Using technical rules.");
    const model = eligible[0];
    const budget = budgetState(provider);
    // The daily free-tier budget is always enforced.
    if (budget.callsToday >= budget.dailyLimit) {
      return lastModelIssue ?? fail(`Daily free-tier budget reached (${budget.callsToday}/${budget.dailyLimit} calls today).`);
    }
    // Min-interval spacing throttles separate predict() calls, but a retry inside
    // THIS request moves to a DIFFERENT model — not the hammering the spacing gate
    // exists to prevent — so only the first attempt honours it.
    if (attempt === 0 && budget.waitSeconds > 0) {
      return lastModelIssue ?? fail(`Free-tier spacing: next call allowed in ${budget.waitSeconds}s.`);
    }
    await recordCall(provider);
    const result = await callProvider(provider, context, {
      apiKey, model: model.id, structured: model.structured, fetchImpl,
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.prompt ? { prompt: options.prompt } : {}),
    });
    if (result.ok) return result;

    // Model-specific failure — per-model rate limit, retired model, or unusable
    // non-JSON content. Cool this model down and try the next verified model in
    // the SAME request: the free catalog routinely has several such models in a
    // row and one bad model must not defeat the whole predict() call.
    if (result.retryableModel || result.kind === "bad-output") {
      cool(model.id);
      lastModelIssue = { ...result, error: `${result.error} Trying another verified free model.` };
      continue;
    }
    // Account-level quota / auth / credit / network / timeout: a different model
    // will not help — surface it and let the rule engine answer.
    return result;
  }
  return lastModelIssue
    ? { ...lastModelIssue, error: `${lastModelIssue.error} No other verified free model produced a usable answer in this request.` }
    : fail("No verified free model produced a usable answer. Using technical rules.");
}

/**
 * Test hook: clear the in-process per-model cooldowns so test
 * cases do not leak cooldown state into each other. Never called
 * outside the test harness.
 */
export function __clearCooldownsForTests(): void {
  cooldowns.clear();
}
