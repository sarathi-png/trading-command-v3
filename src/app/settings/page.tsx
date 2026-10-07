"use client";
import { useState, useSyncExternalStore } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { Btn, Chip, Input, Panel, Select, StatusDot, Toggle, useConfirm } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtDateTime } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { LAYOUT_PRESETS, useApp } from "@/stores";
import type { AppSettings, LayoutPreset, SystemStatus } from "@/lib/types";

const ACCENTS = [
  { id: "teal", color: "#57E6D2", label: "Teal" },
  { id: "blue", color: "#6CB2FF", label: "Blue" },
  { id: "purple", color: "#B79CFF", label: "Purple" },
  { id: "amber", color: "#F5B84D", label: "Amber" },
] as const;

const MODULE_LABELS: Record<string, string> = {
  balance: "Balance / equity", margin: "Margin", pnl: "P&L widgets", positions: "Open positions",
  orderbook: "Order book", funding: "Funding rate", volume: "Volume", tradeHistory: "Recent activity",
  strategyScore: "Strategy signal", marketStructure: "Market structure", supportResistance: "Support / resistance",
  risk: "Risk calculator", alerts: "Alert widgets", systemStatus: "System status", apiStatus: "API status",
  latency: "Latency readout", journal: "Journal", analytics: "Analytics",
};

function subscribeToOrigin(): () => void {
  return () => {};
}

function getBrowserOrigin(): string {
  return window.location.origin;
}

function getServerOrigin(): string {
  return "";
}

export default function SettingsPage() {
  const { settings, patchSettings, applySettings, applyLayoutPreset, system, notify } = useApp();
  const [confirm, confirmNode] = useConfirm();
  const { data: caps, refresh: refreshCaps } = usePoll(
    () => api.get<{ capabilities: Record<string, boolean> }>("/api/settings").then((r) => r.capabilities),
    600000
  );
  const { data: audit } = usePoll(
    () => api.get<{ events: { id: number; event: string; detail: Record<string, unknown>; createdAt: string }[] }>("/api/audit"),
    30000
  );

  // ---- Delta credentials (write-only) ------------------------------------
  // The server never returns a stored key, so there is nothing to prefill:
  // the fields are always empty and the badge is the only feedback.
  const { data: creds, refresh: refreshCreds } = usePoll(
    () => api.get<{ configured: boolean; source: "env" | "stored" | "none" }>("/api/settings/delta-credentials"),
    300000
  );
  const [credKey, setCredKey] = useState("");
  const [credSecret, setCredSecret] = useState("");
  const [credBusy, setCredBusy] = useState(false);
  const credentialsFromEnv = creds?.source === "env";

  const saveCredentials = async () => {
    if (!credKey.trim() || !credSecret.trim()) {
      notify({ title: "Both fields are required", body: "Enter the Delta API key and secret.", tone: "warn" });
      return;
    }
    setCredBusy(true);
    try {
      await api.post("/api/settings/delta-credentials", {
        apiKey: credKey.trim(),
        apiSecret: credSecret.trim(),
      });
      setCredKey("");
      setCredSecret("");
      refreshCreds();
      refreshCaps();
      // Saving keys only matters if the data source actually uses them —
      // flip a demo feed over to Delta so rates + balance appear right away.
      const switched = settings.dataSource !== "delta";
      if (switched) await patchSettings({ dataSource: "delta" });
      notify({
        title: "Credentials saved",
        body: switched
          ? "Stored encrypted. Market data switched to Delta Exchange. Public rates load independently; account balances require valid, authorized keys."
          : "Stored encrypted. Public rates load independently; account balances require valid, authorized keys.",
        tone: "success",
      });
    } catch (e) {
      notify({
        title: "Could not save credentials",
        body: e instanceof Error ? e.message : "Unknown error",
        tone: "danger",
      });
    } finally {
      setCredBusy(false);
    }
  };

  const clearCredentials = async () => {
    const ok = await confirm({
      title: "Remove stored keys?",
      danger: true,
      confirmLabel: "Remove keys",
      body: "The encrypted Delta credentials saved from this dashboard will be deleted. Keys supplied through environment variables are unaffected.",
    });
    if (!ok) return;
    setCredBusy(true);
    try {
      await api.del("/api/settings/delta-credentials");
      refreshCreds();
      notify({ title: "Credentials removed", tone: "success" });
    } catch (e) {
      notify({
        title: "Could not remove credentials",
        body: e instanceof Error ? e.message : "Unknown error",
        tone: "danger",
      });
    } finally {
      setCredBusy(false);
    }
  };

  const setMode = async (mode: AppSettings["mode"]) => {
    if (mode === "live" && !caps?.liveExecution) {
      notify({ title: "LIVE mode unavailable", body: "Set LIVE_EXECUTION_ENABLED=true in the server environment first.", tone: "warn" });
      return;
    }
    if (mode === "live") {
      const ok = await confirm({
        title: "Switch to LIVE mode?",
        danger: true,
        confirmLabel: "Switch to LIVE",
        body: "LIVE mode routes order entry toward the exchange adapter. Orders still cannot execute until the master switch is armed, and live execution additionally requires server configuration.",
      });
      if (!ok) return;
    }
    await patchSettings({ mode, ...(mode !== "live" ? { liveArmed: false } : {}) });
    notify({ title: "Mode changed", body: `Execution mode is now ${mode.replace("_", " ").toUpperCase()}`, tone: "info" });
  };

  const toggleArm = async () => {
    if (settings.liveArmed) {
      await patchSettings({ liveArmed: false });
      notify({ title: "Live trading disarmed", tone: "info" });
      return;
    }
    const ok = await confirm({
      title: "ARM LIVE TRADING",
      danger: true,
      confirmLabel: "ARM LIVE TRADING",
      body: "You are enabling the master trading switch. With this armed — and only with LIVE_EXECUTION_ENABLED on the server — confirmed orders can reach Delta Exchange. Type-level confirmation is enforced server-side.",
    });
    if (!ok) return;
    try {
      const res = await api.post<{ settings: AppSettings }>("/api/settings", {
        liveArmed: true, confirm: "ARM-LIVE-TRADING",
      });
      applySettings(res.settings);
      notify({ title: "Live trading ARMED", body: "Master switch ON. Handle with care.", tone: "danger" });
    } catch (e) {
      notify({ title: "Arming refused", body: e instanceof Error ? e.message : "", tone: "danger" });
    }
  };

  return (
    <div className="p-3 max-w-[1100px] mx-auto space-y-3">
      <h1 className="text-[15px] font-semibold">Settings</h1>

      {/* appearance */}
      <Panel title="APPEARANCE">
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="microlabel w-28">ACCENT</span>
            {ACCENTS.map((a) => (
              <button key={a.id} onClick={() => void patchSettings({ accent: a.id })}
                aria-label={`Accent ${a.label}`}
                className={cx("w-7 h-7 rounded-full border-2 transition-transform",
                  settings.accent === a.id ? "border-ink scale-105" : "border-transparent")}
                style={{ backgroundColor: a.color }} />
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="microlabel w-28">THEME</span>
            <Chip>DARK TECHNICAL</Chip>
            <span className="text-[10px] text-dim">OLED and light variants are intentionally not exposed to keep contrast safe.</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-mut">Compact density</span>
            <Toggle checked={settings.density === "compact"} label="Compact density"
              onChange={(v) => void patchSettings({ density: v ? "compact" : "comfortable" })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-mut">Reduce animations</span>
            <Toggle checked={settings.reduceMotion} onChange={(v) => void patchSettings({ reduceMotion: v })} label="Reduce animations" />
          </div>
          <div className="flex items-center gap-2">
            <span className="microlabel w-28">TIMEZONE</span>
            <Select value={settings.timezone} onChange={(e) => void patchSettings({ timezone: e.target.value as AppSettings["timezone"] })}>
              <option value="IST">IST (Asia/Kolkata)</option>
              <option value="UTC">UTC</option>
              <option value="local">Browser local</option>
            </Select>
          </div>
        </div>
      </Panel>

      {/* dashboard */}
      <Panel title="DASHBOARD LAYOUT">
        <div className="p-3 space-y-3">
          <div className="flex gap-1.5 flex-wrap">
            {(Object.keys(LAYOUT_PRESETS) as LayoutPreset[]).filter((p) => p !== "custom").map((p) => (
              <button key={p} onClick={() => void applyLayoutPreset(p)}
                className={cx("h-7 px-3 rounded border text-[10px] tracking-wider uppercase",
                  settings.layout === p ? "border-accent/60 text-accent bg-accent-dim" : "border-edge text-mut hover:text-ink")}>
                {p === "terminal" ? "Full Terminal" : p}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 border-t border-edge pt-3">
            {Object.entries(MODULE_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-[11px] text-mut">{label}</span>
                <Toggle checked={settings.modules[key] !== false} label={label}
                  onChange={(v) => void patchSettings({ modules: { [key]: v } })} />
              </div>
            ))}
          </div>
        </div>
      </Panel>

      {/* market data */}
      <Panel title="MARKET DATA">
        <div className="p-3 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="microlabel w-28">SOURCE</span>
            {(["demo", "delta"] as const).map((src) => (
              <button key={src} onClick={() => void patchSettings({ dataSource: src })}
                className={cx("h-7 px-3 rounded border text-[10px] tracking-wider uppercase",
                  settings.dataSource === src ? "border-accent/60 text-accent bg-accent-dim" : "border-edge text-mut hover:text-ink")}>
                {src === "demo" ? "Demo simulator" : "Delta Exchange India"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-mut">
            <StatusDot tone={system?.deltaMarket === "online" ? "ok" : system?.deltaMarket === "offline" ? "err" : "off"} />
            Delta REST: {system?.deltaMarket ?? "unknown"}
            {settings.dataSource === "delta" && system?.deltaMarket !== "online" && (
              <span className="text-warn text-[10px]">— charts fall back to labelled demo candles if Delta is unreachable</span>
            )}
          </div>
          <p className="text-[10px] text-dim leading-relaxed">
            Public market data needs no credentials. Demo mode is a deterministic simulator and is always clearly labelled — it never impersonates live data.
          </p>
          {settings.dataSource === "demo" && creds?.configured && (
            <p className="text-[10px] text-warn">
              Delta keys are configured, but the chart is currently using demo prices. Select{" "}
              <span className="text-ink">Delta Exchange India</span> above to switch to its public market feed.
            </p>
          )}
        </div>
      </Panel>

      {/* execution */}
      <Panel title="EXECUTION" badge={
        settings.mode === "live" && settings.liveArmed ? <Chip tone="danger" className="pulse-soft">LIVE ARMED</Chip>
        : settings.mode === "paper" ? <Chip tone="warn">PAPER</Chip> : <Chip>READ ONLY</Chip>
      }>
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="microlabel w-28">MODE</span>
            {(["read_only", "paper", "live"] as const).map((m) => (
              <button key={m} onClick={() => void setMode(m)}
                disabled={m === "live" && !caps?.liveExecution}
                className={cx("h-7 px-3 rounded border text-[10px] tracking-wider uppercase disabled:opacity-40",
                  settings.mode === m
                    ? m === "live" ? "border-dn/60 text-dn bg-dn/10" : m === "paper" ? "border-warn/60 text-warn bg-warn/10" : "border-accent/60 text-accent bg-accent-dim"
                    : "border-edge text-mut hover:text-ink")}>
                {m.replace("_", " ")}
              </button>
            ))}
          </div>
          {caps && !caps.liveExecution && (
            <p className="text-[10px] text-dim">LIVE mode requires <span className="num">LIVE_EXECUTION_ENABLED=true</span> in the server environment.</p>
          )}
          <div className="border-t border-edge pt-3 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-ink flex items-center gap-1.5">
                Master trading switch
                {settings.liveArmed ? <Chip tone="danger">ARMED</Chip> : <Chip>DISABLED</Chip>}
              </p>
              <p className="text-[10px] text-dim mt-0.5">Required (in addition to LIVE mode) before any live order can be submitted.</p>
            </div>
            <Toggle checked={settings.liveArmed} onChange={() => void toggleArm()} label="Master trading switch"
              disabled={settings.mode !== "live"} />
          </div>
          {settings.liveArmed && (
            <p className="text-[10px] text-dn flex items-center gap-1.5">
              <ShieldAlert size={12} /> Live execution is armed. Every live order still shows a confirmation dialog and is audit-logged.
            </p>
          )}
        </div>
      </Panel>

      {/* risk */}
      <Panel title="RISK LIMITS">
        <div className="p-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block space-y-1">
              <span className="microlabel">DISPLAY CURRENCY</span>
              <Select value={settings.displayCurrency}
                onChange={(e) => void patchSettings({ displayCurrency: e.target.value as "usd" | "inr" })}>
                <option value="usd">USD ($)</option>
                <option value="inr">INR (₹)</option>
              </Select>
            </label>
            {settings.displayCurrency === "inr" && (
              <label className="block space-y-1">
                <span className="microlabel">USD → ₹ RATE</span>
                <Input type="number" className="w-28" value={String(settings.usdInrRate)}
                  onChange={(e) => void patchSettings({ usdInrRate: parseFloat(e.target.value) || 0 })} />
              </label>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {([
              ["maxDailyLoss", "MAX DAILY LOSS", true],
              ["maxOrderValue", "MAX ORDER VALUE", true],
              ["maxLeverage", "MAX LEVERAGE (×)", false],
              ["maxOpenPositions", "MAX OPEN POSITIONS", false],
            ] as const).map(([key, label, money]) => {
              const rate = settings.displayCurrency === "inr" ? (settings.usdInrRate || 1) : 1;
              const suffix = money ? (settings.displayCurrency === "inr" ? " (₹)" : " ($)") : "";
              const shown = money ? +(settings.riskLimits[key] * rate).toFixed(2) : settings.riskLimits[key];
              return (
                <label key={key} className="block space-y-1">
                  <span className="microlabel">{label}{suffix}</span>
                  <Input type="number" value={String(shown)}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0;
                      const usd = money ? v / rate : v;
                      void patchSettings({ riskLimits: { ...settings.riskLimits, [key]: usd } });
                    }} />
                </label>
              );
            })}
            <p className="col-span-full text-[10px] text-dim">
              Breaching any limit blocks order submission before it reaches the engine.
              {settings.displayCurrency === "inr" && " Limits are stored in USD server-side and converted with the rate above; the engine always evaluates in USD."}
            </p>
          </div>
        </div>
      </Panel>

      {/* delta api */}
      <Panel
        title="DELTA API"
        badge={
          creds?.configured ? (
            <Chip tone="up">
              CONFIGURED{creds.source === "env" ? " · ENV" : " · STORED"}
            </Chip>
          ) : (
            <Chip>NOT CONFIGURED</Chip>
          )
        }
      >
        <div className="p-3 space-y-3 text-[11px] text-mut leading-relaxed">
          <p className="flex items-center gap-2">
            <KeyRound size={13} className="text-accent" />
            {creds?.configured ? (
              <>
                Keys are active from{" "}
                <span className="num text-ink">
                  {creds.source === "env" ? "the server environment" : "encrypted storage"}
                </span>
                . Their presence does not confirm that Delta accepts them.
              </>
            ) : (
              <>
                No keys configured. Paste them below, or set{" "}
                <span className="num text-ink">DELTA_API_KEY</span> /{" "}
                <span className="num text-ink">DELTA_API_SECRET</span> in the server environment
                (environment takes precedence).
              </>
            )}
          </p>

          {credentialsFromEnv ? (
            <p className="rounded border border-edge bg-bg2 p-2 text-[11px] text-dim">
              To replace these keys, update both <span className="num text-ink">DELTA_API_KEY</span> and{" "}
              <span className="num text-ink">DELTA_API_SECRET</span> in Vercel → Project → Settings →
              Environment Variables, then redeploy. Environment credentials take precedence over stored keys.
            </p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="block text-[10px] uppercase tracking-wide">API key</span>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={credKey}
                    onChange={(e) => setCredKey(e.target.value)}
                    placeholder="paste Delta API key"
                    className="w-full rounded border border-edge bg-panel px-2 py-1.5 num text-ink outline-none focus:border-accent/60"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-[10px] uppercase tracking-wide">API secret</span>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={credSecret}
                    onChange={(e) => setCredSecret(e.target.value)}
                    placeholder="paste Delta API secret"
                    className="w-full rounded border border-edge bg-panel px-2 py-1.5 num text-ink outline-none focus:border-accent/60"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  disabled={credBusy}
                  onClick={() => void saveCredentials()}
                  className="rounded border border-accent/60 bg-accent-dim px-3 py-1.5 text-accent hover:text-ink disabled:opacity-50"
                >
                  {credBusy ? "Working…" : creds?.configured ? "Replace keys" : "Save keys"}
                </button>
                {creds?.source === "stored" && (
                  <button
                    disabled={credBusy}
                    onClick={() => void clearCredentials()}
                    className="rounded border border-edge px-3 py-1.5 text-mut hover:text-danger disabled:opacity-50"
                  >
                    Remove stored keys
                  </button>
                )}
              </div>
            </>
          )}

          <p className="text-[10px]">
            Stored keys are encrypted with AES-256-GCM using a key derived from{" "}
            <span className="num">SESSION_SECRET</span>, are never returned by any endpoint, and
            never appear in the audit log. The badge indicates configured keys, not successful
            authentication. Transactions require{" "}
            <span className="num">docs/DELTA_SETUP.md</span> for key permissions. Live orders stay
            blocked by <span className="num">LIVE_EXECUTION_ENABLED</span> regardless of these keys.
          </p>
        </div>
      </Panel>

      {/* tradingview */}
      <TradingViewPanel
        enabled={settings.tradingviewEnabled}
        secret={settings.tradingviewSecret}
        webhookEnv={system?.flags?.TRADINGVIEW_WEBHOOK ?? false}
        onToggle={(v) => void patchSettings({ tradingviewEnabled: v })}
        onSecret={(v) => void patchSettings({ tradingviewSecret: v })}
      />

      {/* feature flags + audit */}
      <Panel title="FEATURE FLAGS (SERVER)">
        <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
          {Object.entries(system?.flags ?? {}).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between">
              <span className="num text-[10px] text-mut">{k}</span>
              <Chip tone={v ? "up" : "default"}>{v ? "ON" : "OFF"}</Chip>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="AUDIT LOG" badge={<span className="text-[9px] num text-dim">{audit?.events.length ?? 0} EVENTS</span>}>
        {!audit || audit.events.length === 0 ? (
          <p className="text-[11px] text-dim p-4">No audited events yet. Mode changes, arming, orders and risk blocks are recorded here.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto divide-y divide-edge/50">
            {audit.events.slice(0, 40).map((e) => (
              <div key={e.id} className="px-3 py-1.5 flex items-center gap-3 text-[10.5px]">
                <span className="num text-dim flex-none">{fmtDateTime(new Date(e.createdAt).getTime(), settings.timezone)}</span>
                <span className="num text-accent">{e.event}</span>
                <span className="text-dim truncate">{JSON.stringify(e.detail)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {confirmNode}
    </div>
  );
}

/* ---- TradingView integration ---------------------------------------------
 * TradingView has no official API to link an account itself; the supported
 * integration is alert → webhook. This panel configures the receiver that
 * already exists at /api/integrations/tradingview/webhook (validated, rate
 * limited, signals-only — it never places orders).
 */
function TradingViewPanel({ enabled, secret, webhookEnv, onToggle, onSecret }: {
  enabled: boolean;
  secret: string;
  webhookEnv: boolean;
  onToggle: (v: boolean) => void;
  onSecret: (v: string) => void;
}) {
  const { notify } = useApp();
  const origin = useSyncExternalStore(subscribeToOrigin, getBrowserOrigin, getServerOrigin);

  const active = enabled || webhookEnv;
  const webhookUrl = `${origin}/api/integrations/tradingview/webhook`;
  const example = JSON.stringify(
    {
      secret: "<your secret>",
      symbol: "BTCUSD",
      action: "LONG",
      price: 89152.68,
      entry: 89152.68,
      stop: 88500,
      target: 90500,
      timeframe: "15m",
      timestamp: "{{timenow}}",
      message: "TV alert",
    },
    null,
    2
  );

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      notify({ title: "Webhook URL copied", tone: "success" });
    } catch {
      notify({ title: "Copy failed", body: "Select the URL manually.", tone: "warn" });
    }
  };

  return (
    <Panel
      title="TRADINGVIEW"
      badge={active ? <Chip tone="up">ENABLED</Chip> : <Chip tone="warn">DISABLED</Chip>}
    >
      <div className="p-3 space-y-3">
        <div className="flex items-center gap-3">
          <Toggle checked={active} onChange={onToggle} disabled={webhookEnv} />
          <div>
            <p className="text-[12px]">Receive TradingView alerts by webhook</p>
            <p className="text-[10.5px] text-dim">
              {webhookEnv
                ? "Forced on by TRADINGVIEW_WEBHOOK_ENABLED=true on the server."
                : "Alerts are stored as signals — no orders are ever placed automatically."}
            </p>
          </div>
        </div>

        <label className="block space-y-1">
          <span className="microlabel">WEBHOOK SECRET</span>
          <Input type="password" value={secret} placeholder="shared secret for TradingView alerts"
            onChange={(e) => onSecret(e.target.value)} className="max-w-md" />
          <span className="text-[10px] text-dim">
            Sent as the <span className="num text-mut">secret</span> field in the payload (or header{" "}
            <span className="num text-mut">x-webhook-secret</span>). TRADINGVIEW_WEBHOOK_SECRET env wins if set.
          </span>
        </label>

        <div className="space-y-1">
          <span className="microlabel">WEBHOOK URL</span>
          <div className="flex gap-2">
            <Input readOnly value={webhookUrl} className="flex-1 num text-[11px]" />
            <Btn onClick={() => void copyUrl()} disabled={!origin}>COPY</Btn>
          </div>
        </div>

        <div className="border-t border-edge pt-2 space-y-1.5">
          <p className="microlabel">IN TRADINGVIEW</p>
          <ol className="text-[11px] text-mut space-y-1 list-decimal list-inside leading-snug">
            <li>Create an alert on any chart.</li>
            <li>Notifications tab → check <span className="text-ink">Webhook</span>.</li>
            <li>Paste the URL above; put this JSON in the message:</li>
          </ol>
          <pre className="bg-bg2 border border-edge rounded p-2 text-[10px] num overflow-x-auto">{example}</pre>
          <p className="text-[10px] text-dim">
            <span className="text-warn">Note:</span> TradingView does not offer an API to link or trade the
            account itself — alert webhooks are the supported integration. The receiver validates the secret,
            rejects payloads older than 5 minutes, and deduplicates repeats.
          </p>
        </div>
      </div>
    </Panel>
  );
}
