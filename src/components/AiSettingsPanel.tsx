"use client";
import ConnectionStatus from "./ConnectionStatus";
import FreeModelCatalog from "./FreeModelCatalog";
/**
 * Settings → AI SIGNAL PREDICTION.
 *
 * Holds the two free-tier keys (OpenRouter, NVIDIA NIM) and the predictor's
 * behaviour switches. Two rules shape this screen:
 *   - a key is written to the server and never read back, so the field is
 *     write-only and shows only a 4-character hint of what is already stored
 *   - the panel states plainly what happens with no key: the built-in rule
 *     engine answers instead, so the feature never silently disappears
 */
import { useCallback, useEffect, useState } from "react";
import { KeyRound, Sparkles } from "lucide-react";
import { Btn, Chip, HelpTip, Input, KV, Panel, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useApp } from "@/stores";
import { AI_FREE_TIER_LIMITS } from "@/lib/ai/types";

interface KeyStatus {
  configured: boolean;
  keySource: "env" | "file" | null;
  keyHint: string | null;
  model: string;
  envNames: string[];
  docsUrl: string;
}

type ProviderId = "openrouter" | "nvidia";

const PROVIDER_COPY: Record<ProviderId, { label: string; placeholder: string; env: string }> = {
  openrouter: { label: "OpenRouter", placeholder: "sk-or-v1-…", env: "OPENROUTER_API_KEY" },
  nvidia: { label: "NVIDIA NIM (build.nvidia.com)", placeholder: "nvapi-…", env: "NVIDIA_API_KEY" },
};

export default function AiSettingsPanel() {
  const { settings, patchSettings, notify } = useApp();
  const ai = settings.aiPrediction ?? { enabled: true, provider: "auto" as const, autoRun: true };
  const [status, setStatus] = useState<Record<ProviderId, KeyStatus> | null>(null);
  const [drafts, setDrafts] = useState<Record<ProviderId, string>>({ openrouter: "", nvidia: "" });
  const [saving, setSaving] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ providers: Record<ProviderId, KeyStatus> }>("/api/ai/keys");
      setStatus(res.providers);
    } catch {
      // A key-status failure must not break the settings page.
    }
  }, []);

  useEffect(() => {
    // Deferred to a microtask so the key status arrives after the first paint
    // instead of inside the effect body.
    let alive = true;
    void Promise.resolve().then(() => (alive ? load() : undefined));
    return () => { alive = false; };
  }, [load]);

  const save = async (provider: ProviderId) => {
    const key = drafts[provider].trim();
    if (!key) return;
    setSaving(provider);
    setError(null);
    try {
      const res = await api.post<{ ok: boolean; providers: Record<ProviderId, KeyStatus> }>("/api/ai/keys", { provider, key });
      setStatus(res.providers);
      setDrafts((d) => ({ ...d, [provider]: "" }));
      notify({ title: `${PROVIDER_COPY[provider].label} key saved`, body: "Stored server-side in data/ai-keys.json", tone: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the key");
    } finally {
      setSaving(null);
    }
  };

  const clear = async (provider: ProviderId) => {
    setSaving(provider);
    setError(null);
    try {
      const res = await api.delete<{ ok: boolean; providers: Record<ProviderId, KeyStatus> }>("/api/ai/keys", { provider });
      setStatus(res.providers);
      notify({ title: `${PROVIDER_COPY[provider].label} key removed`, body: "The rule engine will answer instead", tone: "info" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the key");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Panel
      title="AI SIGNAL PREDICTION"
      badge={ai.enabled ? <Chip tone="up">ON</Chip> : <Chip>OFF</Chip>}
    >
      <div className="p-3 space-y-3 text-[11px] text-mut leading-relaxed">
        <p className="flex items-start gap-2">
          <Sparkles size={13} className="text-accent flex-none mt-0.5" />
          <span>
            A model reads the Chandelier Exit and Donchian ribbon on the 5-minute chart and writes a
            structured call — direction, its own stated certainty, the price that would prove it wrong.
            Every call is recorded so it can be scored against what price actually did.
            Predictions are <span className="text-ink">estimates for study, not advice</span>, and nothing
            here places an order.
          </span>
        </p>

        <div className="auto-panels gap-x-6 border-t border-edge pt-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">Enable predictions <HelpTip topic="chandelierStops" /></span>
            <Toggle
              checked={ai.enabled}
              onChange={(v) => void patchSettings({ aiPrediction: { ...ai, enabled: v } })}
              label="Enable AI predictions"
            />
          </div>
          <div className="flex items-center justify-between">
            <span>Run automatically when the chart or symbol changes</span>
            <Toggle
              checked={ai.autoRun}
              onChange={(v) => void patchSettings({ aiPrediction: { ...ai, autoRun: v } })}
              label="Run automatically"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span>Preferred engine</span>
            <select
              value={ai.provider}
              onChange={(e) => void patchSettings({ aiPrediction: { ...ai, provider: e.target.value as typeof ai.provider } })}
              className="bg-bg2 border border-edge rounded px-1.5 h-6 text-[10px] text-ink"
              aria-label="Preferred AI engine"
            >
              <option value="auto">Auto (key first, else rules)</option>
              <option value="openrouter">OpenRouter</option>
              <option value="nvidia">NVIDIA NIM</option>
              <option value="rules">Built-in rule engine only</option>
            </select>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">{error}</p>
        )}

        <div className="space-y-3 border-t border-edge pt-3">
          {(["openrouter", "nvidia"] as ProviderId[]).map((provider) => {
            const info = status?.[provider];
            const limits = AI_FREE_TIER_LIMITS[provider];
            return (
              <div key={provider} className="rounded border border-edge p-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="flex items-center gap-1.5 text-[11px] text-ink">
                    <KeyRound size={12} className="text-accent" />
                    {PROVIDER_COPY[provider].label}
                  </span>
                  {info?.configured ? (
                    <span className="flex items-center gap-1.5">
                      <ConnectionStatus configured label={info.keySource === "env" ? "Key from environment" : "Saved key"} />
                      {info.keyHint && <span className="num text-[10px] text-dim">{info.keyHint}</span>}
                    </span>
                  ) : (
                    <ConnectionStatus configured={info?.configured ?? null} label="API key" />
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="password"
                    autoComplete="off"
                    value={drafts[provider]}
                    onChange={(e) => setDrafts((d) => ({ ...d, [provider]: e.target.value }))}
                    placeholder={PROVIDER_COPY[provider].placeholder}
                    aria-label={`${PROVIDER_COPY[provider].label} API key`}
                    className="flex-1 min-w-[180px]"
                  />
                  <Btn
                    variant="primary"
                    onClick={() => void save(provider)}
                    disabled={saving === provider || !drafts[provider].trim()}
                  >
                    {saving === provider ? "SAVING…" : "SAVE KEY"}
                  </Btn>
                  {info?.configured && info.keySource === "file" && (
                    <Btn variant="ghost" onClick={() => void clear(provider)} disabled={saving === provider}>
                      REMOVE
                    </Btn>
                  )}
                </div>

                <div className="grid gap-1">
                  <FreeModelCatalog key={info?.keyHint ?? "no-key"} provider={provider} configured={Boolean(info?.configured)} />
                  <KV k="Env alternative" v={PROVIDER_COPY[provider].env} />
                  <KV k="Free-tier guard" v={`${limits.dailyLimit} calls/day, ${limits.minIntervalSeconds}s apart`} />
                </div>
                <p className="text-[10px] text-dim">
                  Free-tier keys can be rate-limited or retired by the provider at any time; when that happens the
                  rule engine answers and the panel says so. Get a key at {info?.docsUrl ?? "the provider's site"}.
                </p>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-dim border-t border-edge pt-2">
          Keys are stored server-side only (environment variables, or <span className="num">data/ai-keys.json</span>{" "}
          which is gitignored) and are never sent to the browser after saving — this screen only ever receives a
          4-character hint. Calls are spaced and capped so a free tier cannot be burned by a refresh loop.
        </p>
      </div>
    </Panel>
  );
}
