import { setDisplayCurrency } from "./lib/displayCurrency";
import { create } from "zustand";
import { api } from "./lib/api";
import type { AppSettings, LayoutPreset, SystemStatus, Ticker, Timeframe } from "./lib/types";
import { DEFAULT_SETTINGS } from "./lib/settingsDefaults";
import { SIDEBAR_STORAGE_KEY } from "./lib/navConfig";

export interface UiNotification {
  id: string;
  title: string;
  body?: string;
  tone: "info" | "success" | "warn" | "danger";
  ts: number;
}

/* ---------------- layout presets ---------------- */

export const LAYOUT_PRESETS: Record<LayoutPreset, Partial<Record<string, boolean>>> = {
  minimal: {
    balance: false, margin: false, pnl: true, positions: true, orderbook: false,
    funding: false, volume: false, tradeHistory: false, strategyScore: true,
    marketStructure: false, supportResistance: false, risk: false, alerts: false,
    systemStatus: false, apiStatus: false, latency: false, journal: false, analytics: false,
  },
  trading: {
    balance: true, margin: true, pnl: true, positions: true, orderbook: true,
    funding: false, volume: true, tradeHistory: true, strategyScore: true,
    marketStructure: false, supportResistance: false, risk: true, alerts: true,
    systemStatus: true, apiStatus: false, latency: true, journal: false, analytics: false,
  },
  analysis: {
    balance: false, margin: false, pnl: true, positions: true, orderbook: false,
    funding: true, volume: true, tradeHistory: false, strategyScore: true,
    marketStructure: true, supportResistance: true, risk: false, alerts: true,
    systemStatus: false, apiStatus: false, latency: false, journal: false, analytics: false,
  },
  risk: {
    balance: true, margin: true, pnl: true, positions: true, orderbook: false,
    funding: false, volume: false, tradeHistory: true, strategyScore: false,
    marketStructure: false, supportResistance: false, risk: true, alerts: true,
    systemStatus: true, apiStatus: false, latency: true, journal: false, analytics: false,
  },
  terminal: {
    balance: true, margin: true, pnl: true, positions: true, orderbook: true,
    funding: true, volume: true, tradeHistory: true, strategyScore: true,
    marketStructure: true, supportResistance: true, risk: true, alerts: true,
    systemStatus: true, apiStatus: true, latency: true, journal: true, analytics: true,
  },
  custom: {},
};

export function modulesForPreset(preset: LayoutPreset, base: Record<string, boolean>): Record<string, boolean> {
  const out: Record<string, boolean> = { ...base };
  for (const [k, v] of Object.entries(LAYOUT_PRESETS[preset])) {
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

/* ---------------- app store ---------------- */

interface AppState {
  settings: AppSettings;
  settingsLoaded: boolean;
  activeSymbol: string;
  timeframe: Timeframe;
  system: SystemStatus | null;
  notifications: UiNotification[];
  unread: number;
  paletteOpen: boolean;
  helpOpen: boolean;
  sidebarCollapsed: boolean;

  applySettings: (s: AppSettings) => void;
  patchSettings: (patch: Partial<AppSettings>, persist?: boolean) => Promise<void>;
  applyLayoutPreset: (preset: LayoutPreset) => Promise<void>;
  setSymbol: (s: string) => void;
  setTimeframe: (tf: Timeframe) => void;
  setSystem: (s: SystemStatus) => void;
  notify: (n: Omit<UiNotification, "id" | "ts">) => void;
  dismiss: (id: string) => void;
  clearNotifications: () => void;
  setPalette: (open: boolean) => void;
  setHelp: (open: boolean) => void;
  toggleSidebar: () => void;
}

let notifSeq = 0;

export const useApp = create<AppState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  settingsLoaded: false,
  activeSymbol: "BTCUSD",
  timeframe: "15m",
  system: null,
  notifications: [],
  unread: 0,
  paletteOpen: false,
  helpOpen: false,
  sidebarCollapsed: false,

  applySettings: (s) => { setDisplayCurrency(s); set({ settings: s, settingsLoaded: true }); },

  patchSettings: async (patch, persist = true) => {
    const previous = get().settings;
    const next = {
      ...previous,
      ...patch,
      modules: { ...previous.modules, ...(patch.modules ?? {}) },
      strategiesEnabled: { ...previous.strategiesEnabled, ...(patch.strategiesEnabled ?? {}) },
      riskLimits: { ...previous.riskLimits, ...(patch.riskLimits ?? {}) },
    };
    setDisplayCurrency(next);
    set({ settings: next });
    if (persist) {
      try {
        const res = await api.post<{ settings: AppSettings }>("/api/settings", patch);
        setDisplayCurrency(res.settings);
        set({ settings: res.settings });
      } catch (e) {
        // Do not leave the UI claiming a safety setting the server rejected.
        setDisplayCurrency(previous);
        set({ settings: previous });
        get().notify({
          title: "Setting not saved",
          body: e instanceof Error ? e.message : "The server rejected this change.",
          tone: "danger",
        });
      }
    }
  },

  applyLayoutPreset: async (preset) => {
    const modules = modulesForPreset(preset, DEFAULT_SETTINGS.modules);
    await get().patchSettings({ layout: preset, modules });
  },

  setSymbol: (s) => set({ activeSymbol: s }),
  setTimeframe: (tf) => set({ timeframe: tf }),
  setSystem: (s) => set({ system: s }),

  notify: (n) => {
    console.log('[NOTIFY]', n.title, n.body, new Error().stack?.split('\n').slice(0,3).join('\n'));
    const item: UiNotification = { ...n, id: `n${++notifSeq}`, ts: Date.now() };
    set((st) => ({
      notifications: [item, ...st.notifications].slice(0, 60),
      unread: st.unread + 1,
    }));
  },

  dismiss: (id) =>
    set((st) => {
      const notification = st.notifications.find((n) => n.id === id);
      return {
        notifications: st.notifications.filter((n) => n.id !== id),
        unread: notification ? Math.max(0, st.unread - 1) : st.unread,
      };
    }),

  clearNotifications: () => set({ notifications: [], unread: 0 }),
  setPalette: (open) => set({ paletteOpen: open }),
  setHelp: (open) => set({ helpOpen: open }),
  toggleSidebar: () => {
    // A manual toggle pins the choice and persists it across reloads.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("tc:sidebar-pinned"));
    }
    set((st) => {
      const sidebarCollapsed = !st.sidebarCollapsed;
      if (typeof window !== "undefined") {
        try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0"); } catch { /* storage may be disabled */ }
      }
      return { sidebarCollapsed };
    });
  },
}));

/* ---------------- market store ---------------- */

interface MarketState {
  tickers: Record<string, Ticker>;
  prevPrice: Record<string, number>;
  latencyMs: number | null;
  feed: "connecting" | "live" | "polling" | "lost";
  lastTickAt: number;
  setTickers: (list: Ticker[]) => void;
  setLatency: (ms: number) => void;
  setFeed: (f: MarketState["feed"]) => void;
}

export const useMarket = create<MarketState>((set, get) => ({
  tickers: {},
  prevPrice: {},
  latencyMs: null,
  feed: "connecting",
  lastTickAt: 0,

  setTickers: (list) => {
    const tickers = { ...get().tickers };
    const prevPrice = { ...get().prevPrice };
    for (const t of list) {
      if (tickers[t.symbol]) prevPrice[t.symbol] = tickers[t.symbol].price;
      tickers[t.symbol] = t;
    }
    set({ tickers, prevPrice, lastTickAt: Date.now() });
  },

  setLatency: (ms) => set({ latencyMs: ms }),
  setFeed: (f) => set({ feed: f }),
}));

/* ---------------- alert rules store ---------------- */

import type { AlertRule } from "./lib/types";

interface AlertState {
  rules: AlertRule[];
  setRules: (r: AlertRule[]) => void;
}

export const useAlerts = create<AlertState>((set) => ({
  rules: [],
  setRules: (rules) => set({ rules }),
}));
