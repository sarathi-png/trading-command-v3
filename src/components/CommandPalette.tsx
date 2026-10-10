"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useApp, useMarket } from "@/stores";
import { logout } from "@/lib/api";
import { TIMEFRAMES, type Timeframe } from "@/lib/types";
import { cx } from "@/lib/format";

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: string;
  perform: () => void;
}

export default function CommandPalette() {
  const router = useRouter();
  const { paletteOpen, setPalette, activeSymbol, setSymbol, setTimeframe, applyLayoutPreset, patchSettings, settings } = useApp();
  const tickers = useMarket((s) => s.tickers);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const go = (path: string) => () => { router.push(path); setPalette(false); };
    const nav: Command[] = [
      { id: "go-overview", label: "Open Overview", group: "Navigate", hint: "O", perform: go("/") },
      { id: "go-chart", label: "Open Chart", group: "Navigate", hint: "C", perform: go("/chart") },
      { id: "go-markets", label: "Open Markets", group: "Navigate", perform: go("/markets") },
      { id: "go-positions", label: "Show Positions", group: "Navigate", hint: "P", perform: go("/positions") },
      { id: "go-orders", label: "Show Orders", group: "Navigate", perform: go("/orders") },
      { id: "go-strategy", label: "Open Strategy", group: "Navigate", perform: go("/strategy") },
      { id: "go-journal", label: "Open Trade Journal", group: "Navigate", hint: "J", perform: go("/journal") },
      { id: "go-analytics", label: "Open Analytics", group: "Navigate", perform: go("/analytics") },
      { id: "go-alerts", label: "Open Alerts", group: "Navigate", hint: "A", perform: go("/alerts") },
      { id: "go-settings", label: "Open Settings", group: "Navigate", perform: go("/settings") },
    ];
    const symbols: Command[] = Object.keys(tickers).length
      ? Object.keys(tickers).map((s) => ({
          id: `sym-${s}`, label: `Open ${s}`, hint: `$${tickers[s].price.toLocaleString("en-US", { maximumFractionDigits: 1 })}`,
          group: "Market",
          perform: () => { setSymbol(s); router.push("/chart"); setPalette(false); },
        }))
      : [];
    const tfs: Command[] = TIMEFRAMES.map((tf) => ({
      id: `tf-${tf}`, label: `Change timeframe to ${tf}`, group: "Timeframe",
      perform: () => { setTimeframe(tf); setPalette(false); },
    }));
    const layouts: Command[] = (["minimal", "trading", "analysis", "risk", "terminal"] as const).map((p) => ({
      id: `layout-${p}`, label: `Layout: ${p === "terminal" ? "Full Terminal" : p[0].toUpperCase() + p.slice(1)}`,
      group: "Layout",
      perform: () => { void applyLayoutPreset(p); setPalette(false); },
    }));
    const actions: Command[] = [
      {
        id: "mode-paper", label: settings.mode === "paper" ? "Switch to Read Only" : "Enable Paper Mode",
        group: "Actions",
        perform: () => { void patchSettings({ mode: settings.mode === "paper" ? "read_only" : "paper" }); setPalette(false); },
      },
      {
        id: "toggle-ob", label: settings.modules.orderbook ? "Hide Order Book" : "Show Order Book",
        group: "Actions",
        perform: () => { void patchSettings({ modules: { orderbook: !settings.modules.orderbook } }); setPalette(false); },
      },
      {
        id: "toggle-pnl", label: settings.modules.pnl ? "Hide P&L module" : "Show P&L module",
        group: "Actions",
        perform: () => { void patchSettings({ modules: { pnl: !settings.modules.pnl } }); setPalette(false); },
      },
      {
        id: "reset-layout", label: "Reset layout to Trading default", group: "Actions",
        perform: () => { void applyLayoutPreset("trading"); setPalette(false); },
      },
      {
        id: "logout", label: "Log out", group: "Session",
        perform: () => { setPalette(false); void logout(); },
      },
    ];
    return [...nav, ...symbols, ...tfs, ...layouts, ...actions];
  }, [router, tickers, settings, setPalette, setSymbol, setTimeframe, applyLayoutPreset, patchSettings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    const timeout = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timeout);
  }, []);

  if (!paletteOpen) return null;

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-110 flex items-start justify-center pt-[14vh] p-4" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="absolute inset-0 bg-black/70" onClick={() => setPalette(false)} />
      <div className="relative panel w-full max-w-xl slide-in overflow-hidden">
        <div className="flex items-center gap-2 border-b border-edge px-3">
          <Search size={13} className="text-dim" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { filtered[index]?.perform(); }
              else if (e.key === "Escape") { setPalette(false); }
            }}
            placeholder="Type a command…  (open BTCUSD, 15m, paper mode, reset layout)"
            className="flex-1 bg-transparent h-10 outline-none text-[13px] placeholder:text-dim"
            aria-label="Command search"
          />
          <kbd className="text-[9px] text-dim border border-edge rounded px-1 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-[46vh] overflow-y-auto py-1">
          {filtered.length === 0 && <p className="text-[12px] text-dim text-center py-6">No matching commands</p>}
          {filtered.map((c, i) => {
            const showGroup = c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {showGroup && <p className="microlabel px-3 pt-2 pb-1">{c.group}</p>}
                <button
                  onClick={c.perform}
                  onMouseEnter={() => setIndex(i)}
                  className={cx(
                    "w-full flex items-center justify-between px-3 py-1.5 text-left text-[12px]",
                    i === index ? "bg-accent-dim text-ink" : "text-mut hover:text-ink"
                  )}
                >
                  <span>{c.label}</span>
                  {c.hint && <span className="num text-[10px] text-dim">{c.hint}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="border-t border-edge px-3 h-7 flex items-center gap-3 text-[10px] text-dim">
          <span>↑↓ navigate</span><span>↵ run</span><span>esc close</span>
          <span className="ml-auto">TRADING COMMAND</span>
        </div>
      </div>
    </div>
  );
}
