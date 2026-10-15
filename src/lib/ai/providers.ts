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
  | { ok: false; kind: AiFailureKind; error: string; model: string; latencyMs: number };

export interface CallOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Caller-provided fetch, so tests never touch the network. */
  fetchImpl?: typeof fetch;
}

function classifyStatus(status: number, body: string): { kind: AiFailureKind; error: string } {
  const snippet = body.replace(/\s+/g, " ").slice(0, 200);
  if (status === 401 || status === 403) return { kind: "auth", error: `Provider rejected the API key (HTTP ${status}). ${snippet}` };
  if (status === 429) return { kind: "rate-limited", error: `Provider rate limit reached (HTTP 429). ${snippet}` };
  if (status === 402) return { kind: "auth", error: `Provider reports insufficient credit (HTTP 402). ${snippet}` };
  if (status >= 500) return { kind: "network", error: `Provider error (HTTP ${status}). ${snippet}` };
  return { kind: "bad-output", error: `Unexpected provider response (HTTP ${status}). ${snippet}` };
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
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt(context) },
    ],
    temperature: 0.2,
    max_tokens: 500,
    // Free endpoints honour this on some models and ignore it on others; the
    // validator is what actually guarantees shape, so this is a hint only.
    response_format: { type: "json_object" },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);
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
      return { ok: false, kind, error, model, latencyMs };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, kind: "bad-output", error: "Provider response was not JSON", model, latencyMs };
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
      error: aborted ? "Provider did not answer in time" : `Network error: ${e instanceof Error ? e.message : "unknown"}`,
      model,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** OpenAI-compatible envelope: choices[0].message.content. */
export function extractMessageContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) return null;
  const first = choices[0] as { message?: { content?: unknown }; text?: unknown };
  const content = first?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  // Some NIM models stream deltas into a single choice; accept that shape too.
  if (typeof first?.text === "string" && first.text.trim()) return first.text;
  return null;
}
