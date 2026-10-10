"use client";
import { useState } from "react";
import { Bell, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Btn, Chip, EmptyState, Input, Panel, Select, Skeleton, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, fmtPrice } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useAlerts, useApp } from "@/stores";
import type { AlertRule } from "@/lib/types";

const KIND_LABEL: Record<AlertRule["kind"], string> = {
  price_above: "Price crosses above",
  price_below: "Price crosses below",
  zone_enter: "Price enters zone",
  signal: "Strategy signal (any setup)",
  pnl_below: "Open P&L falls below",
  strategy_signal: "Strategy signal (LONG/SHORT setup)",
};

export default function AlertsPage() {
  const { settings, patchSettings, notify } = useApp();
  const { rules, setRules } = useAlerts();
  const { loading, refresh } = usePoll(async () => {
    const res = await api.get<{ rules: AlertRule[] }>("/api/alerts");
    setRules(res.rules);
    return res.rules;
  }, 60000);

  const [form, setForm] = useState({
    symbol: "BTCUSD", kind: "price_above" as AlertRule["kind"], level: "", level2: "", sound: true, browser: false,
  });

  const create = async () => {
    const body: Record<string, unknown> = {
      symbol: form.symbol.toUpperCase(), kind: form.kind,
      level: form.level ? parseFloat(form.level) : null,
      level2: form.level2 ? parseFloat(form.level2) : null,
      sound: form.sound, browser: form.browser,
    };
    if (form.browser && typeof Notification !== "undefined" && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch { /* denied */ }
    }
    try {
      await api.post("/api/alerts", body);
      notify({ title: "Alert armed", body: `${form.symbol}: ${KIND_LABEL[form.kind]}`, tone: "info" });
      refresh();
    } catch (e) {
      notify({ title: "Could not create alert", body: e instanceof Error ? e.message : "", tone: "danger" });
    }
  };

  return (
    <div className="p-3 grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-3 max-w-[1400px] mx-auto">
      <Panel title="ALERT RULES" badge={<span className="text-[9px] num text-dim">{rules.filter((r) => r.enabled && !r.triggeredAt).length} ARMED</span>}>
        {loading && rules.length === 0 ? (
          <div className="p-3 space-y-1.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : rules.length === 0 ? (
          <EmptyState icon={<Bell size={18} />} title="No alert rules defined"
            hint="Arm price-cross, zone-entry or P&L alerts. They evaluate against the live ticker stream and notify in the dashboard." />
        ) : (
          <div className="divide-y divide-edge/60">
            {rules.map((r) => (
              <div key={r.id} className="px-3 py-2 flex items-center gap-3 flex-wrap">
                <Toggle checked={r.enabled} label="Enable rule" onChange={(v) => void api.patch("/api/alerts", { id: r.id, enabled: v }).then(refresh)} />
                <div className="flex-1 min-w-40">
                  <p className="text-[12px]">
                    <span className="num">{r.symbol}</span>{" "}
                    <span className="text-mut">{KIND_LABEL[r.kind]}</span>{" "}
                    {r.level !== null && <span className="num text-accent">{fmtPrice(r.level)}</span>}
                    {r.level2 !== null && <span className="num text-accent"> – {fmtPrice(r.level2)}</span>}
                  </p>
                  <p className="text-[9.5px] text-dim mt-0.5">
                    {r.sound && "sound · "}{r.browser && "browser · "}
                    {r.triggeredAt ? `triggered ${fmtDateTime(new Date(r.triggeredAt).getTime(), settings.timezone)}` : "armed"}
                  </p>
                </div>
                {r.triggeredAt ? (
                  <Chip tone="warn">TRIGGERED</Chip>
                ) : r.enabled ? (
                  <Chip tone="accent">ARMED</Chip>
                ) : (
                  <Chip>PAUSED</Chip>
                )}
                {r.triggeredAt && (
                  <button
                    title="Re-arm"
                    aria-label="Re-arm alert"
                    onClick={() => void api.patch("/api/alerts", { id: r.id, reset: true }).then(refresh)}
                    className="text-dim hover:text-accent"
                  >
                    <RotateCcw size={13} />
                  </button>
                )}
                <button
                  aria-label="Delete alert"
                  onClick={() => void api.del(`/api/alerts?id=${r.id}`).then(refresh)}
                  className="text-dim hover:text-dn"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="space-y-3">
        <Panel title="NEW ALERT">
          <div className="p-3 space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1"><span className="microlabel">SYMBOL</span>
                <Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} /></label>
<label className="block space-y-1"><span className="microlabel">CONDITION</span>
                <Select className="w-full" value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as AlertRule["kind"] })}>
                  <option value="price_above">price crosses above</option>
                  <option value="price_below">price crosses below</option>
                  <option value="zone_enter">price enters zone</option>
                  <option value="pnl_below">open P&L below</option>
                  <option value="strategy_signal">strategy signal (LONG/SHORT)</option>
                </Select></label>
            </div>
            <label className="block space-y-1"><span className="microlabel">{form.kind === "zone_enter" ? "ZONE LOWER" : "LEVEL"}</span>
              <Input inputMode="decimal" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} /></label>
            {form.kind === "zone_enter" && (
              <label className="block space-y-1"><span className="microlabel">ZONE UPPER</span>
                <Input inputMode="decimal" value={form.level2} onChange={(e) => setForm({ ...form, level2: e.target.value })} /></label>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-dim">Sound</span>
              <Toggle checked={form.sound} onChange={(v) => setForm({ ...form, sound: v })} label="Sound" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-dim">Browser notification</span>
              <Toggle checked={form.browser} onChange={(v) => setForm({ ...form, browser: v })} label="Browser notification" />
            </div>
            <Btn variant="primary" className="w-full" onClick={() => void create()}><Plus size={12} /> ARM ALERT</Btn>
            <p className="text-[9.5px] text-dim leading-snug">
              Channels today: dashboard notification, sound, browser. Telegram / email are planned integrations and stay off until configured.
            </p>
          </div>
        </Panel>

        <Panel title="GLOBAL NOTIFICATION SETTINGS">
          <div className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-mut">Master sound</span>
              <Toggle checked={settings.alertSound} onChange={(v) => void patchSettings({ alertSound: v })} label="Master sound" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-mut">Allow browser notifications</span>
              <Toggle checked={settings.alertBrowser} onChange={(v) => {
                if (v && typeof Notification !== "undefined" && Notification.permission === "default") {
                  void Notification.requestPermission();
                }
                void patchSettings({ alertBrowser: v });
              }} label="Browser notifications" />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
