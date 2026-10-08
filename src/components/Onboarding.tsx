"use client";
import { useState } from "react";
import { ShieldCheck, Wifi, WifiOff, ChartCandlestick, LayoutGrid, Check } from "lucide-react";
import { useApp, modulesForPreset } from "@/stores";
import { api } from "@/lib/api";
import { DEFAULT_SETTINGS } from "@/lib/settingsDefaults";
import { Btn } from "./ui";
import { cx } from "@/lib/format";
import type { AppSettings, ExecMode, LayoutPreset } from "@/lib/types";

const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"];

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="slide-in">
      <p className="microlabel">STEP {n} / 5</p>
      <h2 className="text-lg font-semibold mt-1 mb-4">{title}</h2>
      {children}
    </div>
  );
}

export default function Onboarding({ capabilities }: {
  capabilities: { liveExecution: boolean; deltaAccountConfigured: boolean };
}) {
  const { applySettings, notify } = useApp();
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<ExecMode>("read_only");
  const [symbol, setSymbol] = useState("BTCUSD");
  const [layout, setLayout] = useState<LayoutPreset>("trading");
  const [finishing, setFinishing] = useState(false);

  const finish = async () => {
    setFinishing(true);
    const modules = modulesForPreset(layout, DEFAULT_SETTINGS.modules);
    const watchlist = [symbol, ...["BTCUSD", "ETHUSD", "SOLUSD"].filter((s) => s !== symbol)];
    try {
      const res = await api.post<{ settings: AppSettings }>("/api/settings", {
        onboarded: true,
        mode,
        layout,
        modules,
        watchlist,
        dataSource: capabilities.deltaAccountConfigured ? "delta" : "demo",
      });
      applySettings(res.settings);
    } catch (e) {
      notify({
        title: "Could not save workspace",
        body: e instanceof Error ? e.message : "Settings were not saved. Please retry.",
        tone: "danger",
      });
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-120 bg-bg grid-bg flex items-center justify-center p-4">
      <div className="panel w-full max-w-xl p-6">
        <div className="flex items-center gap-2 mb-6">
          <Logo />
          <div>
            <p className="text-[13px] font-semibold tracking-[0.18em]">TRADING COMMAND</p>
            <p className="text-[10px] text-dim tracking-wide">PERSONAL TRADING INTELLIGENCE</p>
          </div>
        </div>

        {step === 0 && (
          <Step n={1} title="Build your trading workspace.">
            <p className="text-[12px] text-mut leading-relaxed">
              One private terminal for market data, charting, strategy signals, risk,
              paper execution and your trade journal. Everything is optional, everything
              is under your control.
            </p>
            <ul className="mt-4 space-y-2 text-[12px] text-mut">
              <li className="flex gap-2"><Check size={13} className="text-accent mt-0.5" /> Works fully in demo mode — no exchange account needed</li>
              <li className="flex gap-2"><Check size={13} className="text-accent mt-0.5" /> Execution starts <span className="text-ink">READ ONLY</span>; paper and live are explicit upgrades</li>
              <li className="flex gap-2"><Check size={13} className="text-accent mt-0.5" /> API secrets stay on the server, never in your browser</li>
            </ul>
          </Step>
        )}

        {step === 1 && (
          <Step n={2} title="Choose your starting mode">
            <div className="space-y-2">
              {(
                [
                  { id: "read_only", name: "Read Only", desc: "Market data, analysis, journal. No order entry. Recommended start." },
                  { id: "paper", name: "Paper Trading", desc: "Simulated orders and positions against live-style prices." },
                  { id: "live", name: "Live Trading", desc: "Real orders via Delta. Requires server configuration and explicit arming." },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  disabled={m.id === "live" && !capabilities.liveExecution}
                  onClick={() => setMode(m.id)}
                  className={cx(
                    "w-full text-left panel-2 p-3 transition-colors",
                    mode === m.id ? "border-accent/60" : "hover:border-edge2",
                    m.id === "live" && !capabilities.liveExecution && "opacity-45"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cx("dot", mode === m.id ? "bg-accent dot-live text-accent" : "bg-dim")} />
                    <span className="text-[13px] font-medium">{m.name}</span>
                    {m.id === "live" && !capabilities.liveExecution && (
                      <span className="text-[10px] text-warn ml-auto">disabled by configuration</span>
                    )}
                  </div>
                  <p className="text-[11px] text-dim mt-1 ml-4.5">{m.desc}</p>
                </button>
              ))}
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step n={3} title="Connect Delta Exchange">
            {capabilities.deltaAccountConfigured ? (
              <div className="panel-2 p-3 flex items-center gap-3">
                <Wifi size={16} className="text-up" />
                <div>
                  <p className="text-[12px] text-up">Delta credentials are configured</p>
                  <p className="text-[11px] text-dim">
                    This confirms the trading gateway is configured, not that Delta has accepted its
                    key. Setup will use Delta public market data; a private-account authentication
                    error means the gateway&apos;s key, permissions, or IP allowlist need checking.
                  </p>
                </div>
              </div>
            ) : (
              <div className="panel-2 p-3 flex items-center gap-3">
                <WifiOff size={16} className="text-warn" />
                <div>
                  <p className="text-[12px] text-warn">No Delta credentials configured</p>
                  <p className="text-[11px] text-dim leading-relaxed">
                    The workspace runs in demo mode with simulated market data — clearly labelled.
                    To connect your account, deploy the static-IP trading gateway and set{" "}
                    <span className="num text-mut">TRADING_GATEWAY_URL</span> /{" "}
                    <span className="num text-mut">TRADING_GATEWAY_SECRET</span> here. The Delta key and
                    secret exist only on the gateway, never in this app, the browser or the database.
                  </p>
                </div>
              </div>
            )}
            <p className="text-[11px] text-dim mt-3 flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-accent" /> You can change this at any time in Settings → Delta API.
            </p>
          </Step>
        )}

        {step === 3 && (
          <Step n={4} title="Default symbol">
            <div className="grid grid-cols-2 gap-2">
              {SYMBOLS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSymbol(s)}
                  className={cx("panel-2 p-3 text-left", symbol === s ? "border-accent/60" : "hover:border-edge2")}
                >
                  <p className="num text-[13px]">{s}</p>
                  <p className="text-[10px] text-dim">Perpetual futures</p>
                </button>
              ))}
            </div>
          </Step>
        )}

        {step === 4 && (
          <Step n={5} title="Choose a layout">
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "minimal", name: "Minimal", desc: "Price, chart, position, P&L, signal." },
                  { id: "trading", name: "Trading", desc: "Chart + order tools + risk." },
                  { id: "analysis", name: "Analysis", desc: "Structure, S/R, strategies." },
                  { id: "terminal", name: "Full Terminal", desc: "Every module enabled." },
                ] as const
              ).map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLayout(l.id)}
                  className={cx("panel-2 p-3 text-left", layout === l.id ? "border-accent/60" : "hover:border-edge2")}
                >
                  <p className="text-[12px] font-medium flex items-center gap-1.5">
                    {l.id === "terminal" ? <LayoutGrid size={12} /> : <ChartCandlestick size={12} />} {l.name}
                  </p>
                  <p className="text-[10px] text-dim mt-1">{l.desc}</p>
                </button>
              ))}
            </div>
          </Step>
        )}

        {step === 5 && (
          <Step n={5} title="Your workspace is ready.">
            <p className="text-[12px] text-mut leading-relaxed">
              Mode <Chip>{mode.toUpperCase()}</Chip> · Symbol <Chip>{symbol}</Chip> · Layout <Chip>{layout.toUpperCase()}</Chip>
            </p>
            <p className="text-[11px] text-dim mt-3">
              Press <kbd className="border border-edge rounded px-1">Ctrl</kbd>+<kbd className="border border-edge rounded px-1">K</kbd> anytime
              for the command palette, and <kbd className="border border-edge rounded px-1">?</kbd> for shortcuts.
            </p>
          </Step>
        )}

        <div className="flex items-center justify-between mt-6">
          <Btn variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || finishing}>
            Back
          </Btn>
          {step < 5 ? (
            <Btn variant="primary" size="md" onClick={() => setStep((s) => s + 1)}>Continue</Btn>
          ) : (
            <Btn variant="primary" size="md" onClick={() => void finish()} disabled={finishing}>
              {finishing ? "Preparing workspace…" : "Enter workspace"}
            </Btn>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="num text-accent bg-accent-dim border border-accent/25 rounded px-1.5 py-0.5 text-[10px] mx-0.5">{children}</span>;
}

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="21" height="21" rx="4" stroke="var(--accent)" strokeWidth="1.4" />
      <path d="M6 14.5 L10 9.5 L13.5 12.5 L18 6.5" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="6.5" r="1.6" fill="var(--accent)" />
    </svg>
  );
}
