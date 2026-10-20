/**
 * OpenAI-compatible chat-completion clients (OpenRouter, NVIDIA NIM).
 *
 * Both providers expose the same `/chat/completions` shape, so one client with
 * a per-provider base URL, model and headers covers both. Failure is classified
 * rather than collapsed into a string, because the right response differs:
 *   - rate-limited → wait and fall back to the rule engine, tell the user when
 *     the quota returns
 *   - auth         → the key is wrong/expired; say so loudly, do not retry
 *   - network      → transient; fall back quietly
 *   - bad-output   → the model answered but not usably; fall back and say so
 *
 * The client never throws: every path returns a discriminated result.
 */
import { AI_PROVIDER_CATALOG, type AiProviderId } from "./types";
import { extractJson, systemPrompt, userPrompt } from "./prompt";
import type { AiContext } from "./types";

export type AiFailureKind = "not-configured" | "rate-limited" | "auth" | "network" | "timeout" | "bad-output";

export type AiCallResult =
  | { ok: true; raw: unknown; model: string; latencyMs: number }
  | { ok: false; kind: AiFailureKind; error: string; model: string; latencyMs: number; retryableModel?: boolean };

export interface CallOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** True when the model declares response_format support (JSON object mode). */
  structured?: boolean;
  /** Caller-provided fetch, so tests never touch the network. */
  fetchImpl?: typeof fetch;
  /**
   * Optional prompt override for non-prediction features (strategy
   * research). The default prediction prompt stays untouched when
   * absent, so the signal path is unchanged.
   */
  prompt?: { system: string; user: string };
}

function classifyStatus(status: number, body: string): { kind: AiFailureKind; error: string } {
  // Never expose upstream bodies: they can include account IDs and request metadata.
  if (status === 401 || status === 403) return { kind: "auth", error: `Provider rejected the API key (HTTP ${status}). Check credentials.` };
  if (status === 429) return { kind: "rate-limited", error: "Provider quota reached. Waiting before another request." };
  if (status === 402) return { kind: "auth", error: "Provider credit unavailable. Paid fallback is disabled." };
  if (status >= 500) return { kind: "network", error: `Provider temporarily unavailable (HTTP ${status}).` };
  void body;
  return { kind: "bad-output", error: `Model unavailable or incompatible (HTTP ${status}).` };
}

/** Call one provider and return the raw parsed JSON the model produced. */
export async function callProvider(
  provider: Exclude<AiProviderId, "rules">,
  context: AiContext,
  options: CallOptions
): Promise<AiCallResult> {
  const catalog = AI_PROVIDER_CATALOG[provider];
  const model = options.model || catalog.defaultModel;
  const doFetch = options.fetchImpl ?? fetch;
  const started = Date.now();

  if (!options.apiKey) {
    return { ok: false, kind: "not-configured", error: "No API key configured", model, latencyMs: 0 };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${options.apiKey}`,
  };
  if (provider === "openrouter") {
    // OpenRouter attributes free-tier traffic to the referring app.
    headers["HTTP-Referer"] = "https://github.com/sarathi-png/trading-command-v3";
    headers["X-Title"] = "Trading Command Center";
  }

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: options.prompt?.system ?? systemPrompt() },
      { role: "user", content: options.prompt?.user ?? userPrompt(context) },
    ],
    temperature: 0.2,
    // Give reasoning models room to think AND then emit their final JSON answer.
    max_tokens: 2048,
    // Force JSON output for models that declare response_format support. This
    // keeps reasoning/thinking models from leaving an empty `content` field and
    // stops prose (chain-of-thought) from being mistaken for the answer. Models
    // without support simply skip this field and rely on the prompt + validator.
    ...(options.structured ? { response_format: { type: "json_object" } } : {}),
    ...(provider === "openrouter" ? { provider: { max_price: { prompt: 0, completion: 0 } } } : {}),
  };

  const controller = new AbortController();
  // Free models can be slow (thinking + JSON); 25s was timing out on several.
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 50_000);
  try {
    const res = await doFetch(catalog.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      const { kind, error } = classifyStatus(res.status, text);
      // A failure is model-specific (safe to rotate in-request) when it names the
      // model we called or the word "model", and is not an account-level limit.
      // OpenRouter per-model rate-limit bodies embed the model id; account/credit
      // limits do not and are flagged by the keyword exclusion.
      const modelSpecific = text.includes(model) || /model/i.test(text);
      const accountLevel = /account|daily|credit|global|insufficient/i.test(text);
      return {
        ok: false, kind, error, model, latencyMs,
        retryableModel: [404, 410].includes(res.status) || (res.status === 429 && modelSpecific && !accountLevel),
      };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, kind: "bad-output", error: "Provider response was not JSON", model, latencyMs };
    }
    // Providers can report an error inside an otherwise successful HTTP response.
    const upstreamError = payload && typeof payload === "object"
      ? (payload as { error?: unknown }).error : undefined;
    if (upstreamError) {
      const message = typeof upstreamError === "string" ? upstreamError
        : typeof upstreamError === "object" && typeof (upstreamError as { message?: unknown }).message === "string"
          ? (upstreamError as { message: string }).message : "Unspecified upstream error";
      // Do not forward metadata or accidentally echo the configured credential.
      const safeMessage = message.split(options.apiKey).join("[redacted]").replace(/[\r\n]+/g, " ").slice(0, 300);
      return { ok: false, kind: "bad-output", error: `Provider error: ${safeMessage}`, model, latencyMs };
    }
    const content = extractMessageContent(payload);
    if (!content) {
      return { ok: false, kind: "bad-output", error: "Provider returned no message content", model, latencyMs };
    }
    try {
      return { ok: true, raw: extractJson(content), model, latencyMs };
    } catch (e) {
      return {
        ok: false,
        kind: "bad-output",
        error: `Model answer was not usable JSON: ${e instanceof Error ? e.message : "parse error"}`,
        model,
        latencyMs,
      };
    }
  } catch (e) {
    const latencyMs = Date.now() - started;
    const aborted = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
    return {
      ok: false,
      kind: aborted ? "timeout" : "network",
      error: aborted ? "Provider did not answer in time" : "Provider network unavailable. Using technical rules.",
      model,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Read common OpenAI-compatible envelopes, preferring final content to reasoning. */
export function extractMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const first = Array.isArray(root.choices) ? root.choices[0] : undefined;
  const choice = first && typeof first === "object" ? first as Record<string, unknown> : {};
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? value as Record<string, unknown> : {};
  const message = record(choice.message);
  const delta = record(choice.delta);
  const readText = (value: unknown): string | null => {
    if (typeof value === "string") return value.trim() ? value : null;
    if (Array.isArray(value)) {
      const text = value.map((part) => {
        if (typeof part === "string") return part;
        const item = record(part);
        return typeof item.text === "string" ? item.text : "";
      }).join("");
      return text.trim() ? text : null;
    }
    return null;
  };
  for (const value of [message.content, choice.text, delta.content, root.content, root.text,
    message.reasoning, message.reasoning_content, delta.reasoning, delta.reasoning_content,
    root.reasoning, root.reasoning_content]) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
}
