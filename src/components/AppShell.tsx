"use client";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import {
  BarChart3, Bell, BookOpen, CandlestickChart, ChevronLeft, ChevronRight,
  Command, LayoutDashboard, Layers, LineChart, ListFilter, LogOut, Search, Settings,
  Target, ArrowUpDown, Bot, Wifi, X, Zap,
} from "lucide-react";
import { useAlerts, useApp, useMarket } from "@/stores";
import { api, ApiError, logout } from "@/lib/api";
import { cx, fmtPct, fmtPrice, fmtTime } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import type { AlertRule, SystemStatus, Ticker } from "@/lib/types";
import CommandPalette from "./CommandPalette";
import LoginGate from "./LoginGate";
import Onboarding, { Logo } from "./Onboarding";
import { Btn, Chip, StatusDot } from "./ui";


const NAV = [
  { href: "/", label: "OVERVIEW", icon: LayoutDashboard },
  { href: "/chart", label: "CHART", icon: LineChart },
  { href: "/markets", label: "MARKETS", icon: CandlestickChart },
  { href: "/positions", label: "POSITIONS", icon: Layers },
  { href: "/orders", label: "ORDERS", icon: ArrowUpDown },
  { href: "/strategy", label: "STRATEGY", icon: Target },
  { href: "/journal", label: "JOURNAL", icon: BookOpen },
  { href: "/analytics", label: "ANALYTICS", icon: BarChart3 },
  { href: "/alerts", label: "ALERTS", icon: Bell },
  { href: "/automation", label: "AUTOMATION", icon: Bot, tag: "OFF" },
  { href: "/settings", label: "SETTINGS", icon: Settings },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const {
    settings, settingsLoaded, applySettings, system, setSystem,
    paletteOpen, setPalette, helpOpen, setHelp, notify,
  } = useApp();
  const [capabilities, setCapabilities] = useState({ liveExecution: false, exchangeAccountConfigured: false });
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [authDenied, setAuthDenied] = useState(false);
  const [settingsLoadError, setSettingsLoadError] = useState<string | null>(null);
  const [settingsNonce, setSettingsNonce] = useState(0);

  /* ---- load settings + system status ---------------------------------- */
  useEffect(() => {
    api.get<{ settings: typeof settings; capabilities: typeof capabilities }>("/api/settings")
      .then((res) => {
        setSettingsLoadError(null);
        applySettings(res.settings);
        setCapabilities(res.capabilities);
      })
      .catch((e) => {
        // 401 = no/expired session: show the login gate rather than falling
        // back to defaults (which silently re-triggered onboarding every time).
        if (e instanceof ApiError && e.status === 401) { setAuthDenied(true); return; }
        setSettingsLoadError(e instanceof Error ? e.message : "Could not load saved settings.");
      });
  }, [applySettings, settingsNonce]);

  /* ---- session expiry can surface on any API call ---------------------- */
  useEffect(() => {
    const onUnauthorized = () => setAuthDenied(true);
    window.addEventListener("auth:unauthorized", onUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", onUnauthorized);
  }, []);

  usePoll(async () => {
    const s = await api.get<SystemStatus>("/api/system");
    setSystem(s);
    return s;
  }, 20000);

  /* ---- document theme attributes --------------------------------------- */
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.accent = settings.accent;
    el.dataset.motion = settings.reduceMotion ? "off" : "on";
    el.dataset.density = settings.density;
  }, [settings.accent, settings.reduceMotion, settings.density]);

  /* ---- market feed: REST polling (the venue socket is server-side only) -- */
  const symbolsKey = useMemo(() => {
    const set = new Set([...settings.watchlist, useApp.getState().activeSymbol, "BTCUSD"]);
    return [...set].join(",");
  }, [settings.watchlist]);

  useEffect(() => {
    if (!settingsLoaded) return;
    let stop = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const pollOnce = async () => {
      const t0 = performance.now();
      try {
        const res = await api.get<{ tickers: Ticker[] }>(`/api/market/tickers?symbols=${symbolsKey}`);
        if (stop) return;
        useMarket.getState().setTickers(res.tickers);
        useMarket.getState().setLatency(Math.round(performance.now() - t0));
        if (useMarket.getState().feed !== "live") useMarket.getState().setFeed("live");
      } catch {
        if (!stop) useMarket.getState().setFeed("lost");
      }
    };
    void pollOnce();
    timer = setInterval(() => void pollOnce(), 2600);

    // No browser-side venue socket: market data is polled from our own API,
    // which reads CoinDCX REST server-side. Streaming would need a long-lived
    // process the Vercel deployment does not have (see
    // src/lib/exchange/coindcx/websocket.ts), and a direct browser→venue socket
    // would add an exfiltration surface for no functional gain.
    return () => { stop = true; if (timer) clearInterval(timer); };
  }, [settingsLoaded, settings.dataSource, symbolsKey, reconnectNonce]);

  /* ---- alert rules ------------------------------------------------------ */
  const { rules, setRules } = useAlerts();
  usePoll(async () => {
    const res = await api.get<{ rules: AlertRule[] }>("/api/alerts");
    setRules(res.rules);
    return res.rules;
  }, 45000);

  const lastTickAt = useMarket((s) => s.lastTickAt);
  const beep = useCallback(() => {
    if (!settings.alertSound) return;
    try {
      const Ctx = window.AudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    } catch { /* audio unavailable */ }
  }, [settings.alertSound]);

  useEffect(() => {
    if (!lastTickAt || rules.length === 0) return;
    const { tickers, prevPrice } = useMarket.getState();
    for (const rule of rules) {
      if (!rule.enabled || rule.triggeredAt) continue;
      const t = tickers[rule.symbol];
      const prev = prevPrice[rule.symbol];
      if (!t || prev === undefined || prev === t.price) continue;
      let fired = false;
      let detail = "";
      if (rule.kind === "price_above" && rule.level !== null && prev < rule.level && t.price >= rule.level) {
        fired = true; detail = `${rule.symbol} crossed above ${rule.level}`;
      } else if (rule.kind === "price_below" && rule.level !== null && prev > rule.level && t.price <= rule.level) {
        fired = true; detail = `${rule.symbol} crossed below ${rule.level}`;
      } else if (rule.kind === "zone_enter" && rule.level !== null && rule.level2 !== null) {
        const inZone = (p: number) => p >= Math.min(rule.level!, rule.level2!) && p <= Math.max(rule.level!, rule.level2!);
        if (!inZone(prev) && inZone(t.price)) { fired = true; detail = `${rule.symbol} entered zone ${rule.level}–${rule.level2}`; }
      }
      if (fired) {
        notify({ title: "Alert triggered", body: detail, tone: "warn" });
        beep();
        if (settings.alertBrowser && rule.browser && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try { new Notification("Trading Command alert", { body: detail }); } catch { /* noop */ }
        }
        api.patch("/api/alerts", { id: rule.id, triggered: true }).catch(() => undefined);
        setRules(rules.map((r) => (r.id === rule.id ? { ...r, triggeredAt: Date.now() } : r)));
      }
    }
  }, [lastTickAt, rules, notify, beep, settings.alertBrowser, setRules]);

  /* ---- paper engine events + new signals → notifications --------------- */
  const seenEvents = useRef(new Set<string>());
  usePoll(async () => {
    if (settings.mode !== "paper") return [];
    const res = await api.get<{ events: { kind: string; message: string }[] }>("/api/paper");
    for (const e of res.events) {
      const key = `${e.kind}:${e.message}`;
      if (!seenEvents.current.has(key)) {
        seenEvents.current.add(key);
        notify({
          title: e.kind === "sl_hit" ? "Stop-loss hit" : e.kind === "tp_hit" ? "Target hit" : "Paper engine",
          body: e.message,
          tone: e.kind === "sl_hit" ? "danger" : e.kind === "tp_hit" ? "success" : "info",
        });
      }
    }
    return res.events;
  }, 7000, { enabled: settingsLoaded && settings.mode === "paper" });

  const seenSignals = useRef(new Set<string>());
  usePoll(async () => {
    const res = await api.get<{ signals: { id: string; status: string; symbol: string; strategy: string; createdAt: string }[] }>("/api/signals?limit=8");
    for (const s of res.signals) {
      if ((s.status === "LONG_SETUP" || s.status === "SHORT_SETUP") && !seenSignals.current.has(s.id)) {
        seenSignals.current.add(s.id);
        if (seenSignals.current.size > 1) { // skip initial hydration batch
          notify({ title: `Signal: ${s.symbol}`, body: `${s.strategy} → ${s.status.replace("_", " ")}`, tone: s.status === "LONG_SETUP" ? "success" : "danger" });
        }
      }
    }
    return res.signals;
  }, 30000, { enabled: settingsLoaded });

  /* ---- keyboard shortcuts ------------------------------------------------ */
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!paletteOpen);
        return;
      }
      if (typing) return;
      const st = useApp.getState();
      if (e.key === "Escape") { setPalette(false); setHelp(false); return; }
      if (e.key === "?") { setHelp(true); return; }
      switch (e.key.toLowerCase()) {
        case "1": st.setTimeframe("1m"); break;
        case "3": st.setTimeframe("3m"); break;
        case "5": st.setTimeframe("5m"); break;
        case "m": st.setTimeframe("15m"); break;
        case "h": st.setTimeframe("1H"); break;
        case "d": st.setTimeframe("1D"); break;
        case "c": router.push("/chart"); break;
        case "p": router.push("/positions"); break;
        case "j": router.push("/journal"); break;
        case "a": router.push("/alerts"); break;
        case "o": router.push("/"); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, router, setPalette, setHelp]);

  /* ---- render ------------------------------------------------------------ */
  if (authDenied) {
    return (
      <LoginGate
        onLoggedIn={() => {
          setAuthDenied(false);
          setSettingsNonce((n) => n + 1); // refetch settings with the fresh cookie
        }}
      />
    );
  }

  if (settingsLoadError) {
    return (
      <div className="h-screen grid-bg flex flex-col items-center justify-center gap-4 p-4">
        <Logo size={34} />
        <p className="microlabel text-warn">SAVED SETTINGS UNAVAILABLE</p>
        <p className="max-w-lg text-center text-[12px] text-mut">{settingsLoadError}</p>
        <p className="max-w-lg text-center text-[11px] text-dim">
          Verify the Vercel database connection and apply the dashboard schema before retrying.
          Your saved settings have not been replaced with onboarding defaults.
        </p>
        <Btn variant="primary" onClick={() => setSettingsNonce((n) => n + 1)}>RETRY</Btn>
      </div>
    );
  }

  if (!settingsLoaded) {
    return (
      <div className="h-screen grid-bg flex flex-col items-center justify-center gap-4">
        <Logo size={34} />
        <p className="microlabel">CONNECTING TO TRADING COMMAND…</p>
      </div>
    );
  }

  if (!settings.onboarded) {
    return <Onboarding capabilities={capabilities} />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TopBar onReconnect={() => setReconnectNonce((n) => n + 1)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 grid-bg overflow-y-auto pb-14 md:pb-0">{children}</main>
      </div>
      <StatusBar />
      <MobileNav />
      {paletteOpen && <CommandPalette />}
      <HelpModal open={helpOpen} onClose={() => setHelp(false)} />
      <NotificationCenter />
    </div>
  );
}

/* ================= top bar ============================================== */

function TopBar({ onReconnect }: { onReconnect: () => void }) {
  const { activeSymbol, setSymbol, timeframe, setTimeframe, settings, system } = useApp();
  const feed = useMarket((s) => s.feed);
  const latency = useMarket((s) => s.latencyMs);
  const { setPalette } = useApp();
  const symbols = settings.watchlist.includes(activeSymbol)
    ? settings.watchlist
    : [activeSymbol, ...settings.watchlist];

  const modeBadge =
    settings.mode === "live" ? (
      settings.liveArmed ? (
        <Chip tone="danger" className="pulse-soft">● LIVE</Chip>
      ) : (
        <Chip tone="danger">LIVE / EXECUTION DISABLED</Chip>
      )
    ) : settings.mode === "paper" ? (
      <Chip tone="warn">PAPER MODE</Chip>
    ) : (
      <Chip>READ ONLY</Chip>
    );

  return (
    <header className="h-11 border-b border-edge bg-panel flex items-center gap-3 px-3 flex-none z-20">
      {/* feed status */}
      {feed === "lost" ? (
        <span className="flex items-center gap-2">
          <Chip tone="danger">⚠ DATA CONNECTION LOST</Chip>
          <Btn size="sm" onClick={onReconnect}>RECONNECT</Btn>
        </span>
      ) : feed === "connecting" ? (
        <Chip tone="warn" className="pulse-soft">CONNECTING TO FEED…</Chip>
      ) : settings.dataSource === "live" ? (
        <Chip tone="up"><StatusDot tone="ok" /> COINDCX LIVE</Chip>
      ) : (
        <Chip tone="warn"><StatusDot tone="warn" /> DEMO FEED</Chip>
      )}

      {/* symbol + live price */}
      <div className="flex items-center gap-2.5 min-w-0">
        <select
          value={activeSymbol}
          onChange={(e) => setSymbol(e.target.value)}
          aria-label="Active symbol"
          className="bg-bg2 border border-edge rounded h-7 px-1.5 text-[12px] num outline-none"
        >
          {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <PriceFlash symbol={activeSymbol} />
      </div>

      {/* timeframe */}
      <select
        value={timeframe}
        onChange={(e) => setTimeframe(e.target.value as typeof timeframe)}
        aria-label="Timeframe"
        className="bg-bg2 border border-edge rounded h-7 px-1.5 text-[12px] num outline-none hidden sm:block"
      >
        {["1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "1D", "1W"].map((tf) => (
          <option key={tf} value={tf}>{tf}</option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-2.5">
        {settings.modules.latency && latency !== null && (
          <span className="num text-[10px] text-dim hidden lg:block">{latency} ms</span>
        )}
        {settings.modules.systemStatus && (
          <span className="hidden md:flex items-center gap-1.5 text-[10px] text-mut">
            <StatusDot tone={system?.db ? "ok" : "err"} /> SYSTEM {system?.db ? "ONLINE" : "DEGRADED"}
          </span>
        )}
        <Chip className="hidden sm:inline-flex">
          {settings.dataSource === "demo"
            ? "DEMO ACCOUNT"
            : system?.exchangeAccount === "configured"
              ? "COINDCX · ACCOUNT UNVERIFIED"
              : "COINDCX · NOT CONFIGURED"}
        </Chip>
        {modeBadge}
        <NotifBell />
        <button
          onClick={() => setPalette(true)}
          className="hidden md:flex items-center gap-1.5 text-[10px] text-dim border border-edge rounded h-7 px-2 hover:text-mut hover:border-edge2"
          aria-label="Open command palette"
        >
          <Command size={11} /> K
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          className="flex items-center gap-1.5 text-[10px] tracking-wide text-dim border border-edge rounded h-7 px-2 hover:text-dn hover:border-dn/40"
          aria-label="Log out"
        >
          <LogOut size={11} />
          <span className="hidden sm:inline">LOG OUT</span>
        </button>
      </div>
    </header>
  );
}

function PriceFlash({ symbol }: { symbol: string }) {
  const t = useMarket((s) => s.tickers[symbol]);
  const prev = useMarket((s) => s.prevPrice[symbol]);
  const [anim, setAnim] = useState("");
  const lastPrice = useRef<number | null>(null);

  useEffect(() => {
    if (!t) return;
    if (lastPrice.current !== null && t.price !== lastPrice.current) {
      setAnim(t.price > lastPrice.current ? "flash-up" : "flash-dn");
      const id = setTimeout(() => setAnim(""), 720);
      lastPrice.current = t.price;
      return () => clearTimeout(id);
    }
    lastPrice.current = t.price;
  }, [t]);

  if (!t) return <span className="num text-dim text-[15px]">…</span>;
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span key={anim + String(t.price)} className={cx("num text-[16px] font-semibold leading-none", anim)}>
        ${fmtPrice(t.price)}
      </span>
      <span className={cx("num text-[11px]", t.change24hPct >= 0 ? "text-up" : "text-dn")}>
        {fmtPct(t.change24hPct)}
      </span>
    </div>
  );
}

/* ================= sidebar ============================================== */

function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar, settings } = useApp();
  return (
    <nav
      aria-label="Primary"
      className={cx(
        "hidden md:flex flex-col border-r border-edge bg-panel2 flex-none transition-[width] duration-200",
        sidebarCollapsed ? "w-12" : "w-47"
      )}
    >
      <div className={cx("flex items-center gap-2 h-11 border-b border-edge flex-none", sidebarCollapsed ? "justify-center px-0" : "px-3")}>
        <Logo size={20} />
        {!sidebarCollapsed && (
          <div className="leading-none">
            <p className="text-[10.5px] font-bold tracking-[0.18em]">TRADING</p>
            <p className="text-[10.5px] font-bold tracking-[0.18em] text-accent">COMMAND</p>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              title={item.label}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-2.5 mx-1.5 px-2.5 h-8 rounded text-[10.5px] tracking-[0.1em] mb-0.5 transition-colors",
                active ? "bg-accent-dim text-accent" : "text-mut hover:text-ink hover:bg-panel"
              )}
            >
              <Icon size={14} className="flex-none" />
              {!sidebarCollapsed && <span className="flex-1">{item.label}</span>}
              {!sidebarCollapsed && item.tag && (
                <span className="text-[8px] text-dim border border-edge rounded px-1">{item.tag}</span>
              )}
            </a>
          );
        })}
      </div>
      <div className="border-t border-edge p-2 flex-none">
        {!sidebarCollapsed && (
          <p className="text-[9px] text-dim px-1 pb-1.5 num">
            MODE: {settings.mode.toUpperCase()}{settings.dataSource === "demo" ? " · DEMO" : ""}
          </p>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          title="Log out"
          aria-label="Log out"
          className={cx(
            "w-full flex items-center h-7 rounded text-[9px] tracking-wide text-dim hover:text-dn hover:bg-panel mb-0.5",
            sidebarCollapsed ? "justify-center" : "justify-center gap-1.5"
          )}
        >
          <LogOut size={12} />
          {!sidebarCollapsed && "LOG OUT"}
        </button>
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center gap-1 text-[9px] text-dim hover:text-mut h-6 rounded hover:bg-panel"
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {sidebarCollapsed ? <ChevronRight size={12} /> : <><ChevronLeft size={12} /> COLLAPSE</>}
        </button>
      </div>
    </nav>
  );
}

/* ================= status bar =========================================== */

function StatusBar() {
  const { system, settings } = useApp();
  const feed = useMarket((s) => s.feed);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <footer className="h-6 border-t border-edge bg-panel2 flex items-center gap-4 px-3 text-[9.5px] text-dim flex-none overflow-hidden whitespace-nowrap">
      <span className="flex items-center gap-1.5">
        <StatusDot tone={settings.dataSource === "live" ? (system?.exchangeMarket === "online" ? "ok" : "err") : "warn"} />
        REST {settings.dataSource === "live" ? (system?.exchangeMarket ?? "…") : "DEMO SIM"}
      </span>
      <span className="hidden sm:flex items-center gap-1.5">
        <StatusDot tone={feed === "live" ? "ok" : feed === "connecting" ? "warn" : "err"} />
        FEED {feed.toUpperCase()}
      </span>
      <span className="hidden sm:flex items-center gap-1.5">
        <StatusDot tone={system?.db ? "ok" : "err"} /> DB {system?.db ? "ONLINE" : "OFFLINE"}
      </span>
      <span className="hidden md:flex items-center gap-1.5">
        <StatusDot tone={system?.strategy ? "ok" : "off"} /> STRATEGY {system?.strategy ? "ONLINE" : "OFFLINE"}
      </span>
      <span className="hidden md:inline text-mut">EXECUTION: {system?.execution ?? "READ ONLY"}</span>
      {system?.webhook && <span className="hidden lg:inline text-warn">TV WEBHOOK ENABLED</span>}
      <span className="ml-auto hidden sm:inline num">
        {fmtTime(now, "UTC", true)} UTC · {fmtTime(now, "IST", true)} IST
      </span>
      <span className="hidden lg:inline">v{system?.version ?? "1.0.0"}</span>
      <span className="hidden xl:inline">Press ? for shortcuts</span>
    </footer>
  );
}

/* ================= mobile nav ============================================ */

function MobileNav() {
  const pathname = usePathname();
  const [more, setMore] = useState(false);
  const items = [
    { href: "/", label: "Home", icon: LayoutDashboard },
    { href: "/chart", label: "Chart", icon: LineChart },
    { href: "/positions", label: "Positions", icon: Layers },
    { href: "/strategy", label: "Signals", icon: Target },
  ];
  return (
    <>
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-14 bg-panel2 border-t border-edge grid grid-cols-5 z-50" aria-label="Mobile">
        {items.map((it) => {
          const Icon = it.icon;
          const active = pathname === it.href;
          return (
            <a key={it.href} href={it.href} className={cx("flex flex-col items-center justify-center gap-0.5 text-[9px]", active ? "text-accent" : "text-dim")}>
              <Icon size={16} />
              {it.label}
            </a>
          );
        })}
        <button onClick={() => setMore(true)} className="flex flex-col items-center justify-center gap-0.5 text-[9px] text-dim">
          <ListFilter size={16} /> More
        </button>
      </nav>
      {more && (
        <div className="md:hidden fixed inset-0 z-90" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMore(false)} />
          <div className="absolute bottom-0 inset-x-0 panel rounded-b-none p-3 slide-in">
            <div className="flex items-center justify-between mb-2">
              <p className="microlabel">MORE</p>
              <button onClick={() => setMore(false)} aria-label="Close"><X size={14} className="text-dim" /></button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} onClick={() => setMore(false)} className="panel-2 p-2.5 text-[10px] tracking-wide text-mut hover:text-ink flex items-center gap-1.5">
                  <n.icon size={13} /> {n.label}
                </a>
              ))}
            </div>
            <button
              type="button"
              onClick={() => { setMore(false); void logout(); }}
              className="mt-2 w-full panel-2 p-2.5 text-[10px] tracking-wide text-dn hover:text-dn flex items-center justify-center gap-1.5"
            >
              <LogOut size={13} /> LOG OUT
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ================= notifications ========================================= */

function NotifBell() {
  const { unread } = useApp();
  const [open, setOpen] = useState(false);
  const { notifications, dismiss, clearNotifications } = useApp();
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications (${unread} unread)`}
        className="relative p-1.5 text-mut hover:text-ink rounded border border-edge h-7 w-7 flex items-center justify-center"
      >
        <Bell size={13} />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-accent text-bg text-[8px] font-bold rounded-full min-w-3.5 h-3.5 px-0.5 flex items-center justify-center num">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-80 panel z-80 slide-in shadow-2xl shadow-black/50">
          <div className="flex items-center justify-between px-3 h-9 border-b border-edge">
            <p className="microlabel">NOTIFICATIONS</p>
            <div className="flex gap-2">
              <button onClick={clearNotifications} className="text-[10px] text-dim hover:text-mut">Clear all</button>
              <button onClick={() => setOpen(false)} aria-label="Close notifications"><X size={12} className="text-dim" /></button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="text-[11px] text-dim text-center py-8">No notifications yet</p>
            )}
            {notifications.map((n) => (
              <div key={n.id} className="px-3 py-2 border-b border-edge/50 flex gap-2 items-start">
                <span className={cx("dot mt-1",
                  n.tone === "success" ? "bg-up text-up" : n.tone === "danger" ? "bg-dn text-dn"
                  : n.tone === "warn" ? "bg-warn text-warn" : "bg-accent text-accent")} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-ink">{n.title}</p>
                  {n.body && <p className="text-[10px] text-dim mt-0.5">{n.body}</p>}
                </div>
                <button onClick={() => dismiss(n.id)} aria-label="Dismiss" className="text-dim hover:text-mut"><X size={11} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationCenter() {
  // The bell dropdown is the notification center; this placeholder keeps the
  // API stable for future global toasts.
  return null;
}

/* ================= help =================================================== */

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const rows = [
    ["Ctrl / ⌘ + K", "Command palette"],
    ["1 / 3 / 5", "Timeframe 1m / 3m / 5m"],
    ["M", "Timeframe 15m"],
    ["H", "Timeframe 1H"],
    ["D", "Timeframe 1D"],
    ["C", "Open chart"],
    ["P", "Open positions"],
    ["J", "Open journal"],
    ["A", "Open alerts"],
    ["O", "Open overview"],
    ["Esc", "Close dialogs"],
    ["?", "This help"],
  ];
  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative panel w-full max-w-sm slide-in">
        <header className="flex items-center justify-between px-4 h-10 border-b border-edge">
          <p className="microlabel">KEYBOARD SHORTCUTS</p>
          <button onClick={onClose} aria-label="Close help"><X size={13} className="text-dim" /></button>
        </header>
        <div className="p-3">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1">
              <span className="text-[11px] text-mut">{v}</span>
              <kbd className="num text-[10px] text-accent bg-accent-dim border border-accent/25 rounded px-1.5 py-0.5">{k}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
