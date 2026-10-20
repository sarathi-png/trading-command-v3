/**
 * Single source of truth for workspace navigation.
 *
 * The sidebar, the mobile drawer, the bottom bar and the command palette all
 * render from this list. Adding a route here makes it reachable everywhere;
 * there is no second array to forget.
 */
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpDown, BarChart3, Beaker, Bell, BookOpen, Bot, BrainCircuit,
  CandlestickChart, LayoutDashboard, Layers, LineChart, Settings, Target,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  /** Shorter label for the four-slot mobile bottom bar. */
  shortLabel: string;
  /** Command-palette phrasing; defaults to `Open ${label}`. */
  paletteLabel?: string;
  /** Keyboard hint shown in the palette when a shortcut exists. */
  hint?: string;
  icon: LucideIcon;
  tag?: string;
  /** Show in the primary mobile bottom bar (the rest live under "More"). */
  mobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "OVERVIEW", shortLabel: "Home", paletteLabel: "Open Overview", hint: "O", icon: LayoutDashboard, mobile: true },
  { href: "/chart", label: "CANDLESTICK", shortLabel: "Chart", paletteLabel: "Open Candlestick", hint: "C", icon: LineChart, mobile: true },
  { href: "/heikin-ashi", label: "HEIKIN-ASHI", shortLabel: "HA", paletteLabel: "Open Heikin-Ashi", icon: LineChart },
  { href: "/markets", label: "MARKETS", shortLabel: "Markets", paletteLabel: "Open Markets", icon: CandlestickChart },
  { href: "/positions", label: "POSITIONS", shortLabel: "Positions", paletteLabel: "Show Positions", hint: "P", icon: Layers, mobile: true },
  { href: "/orders", label: "ORDERS", shortLabel: "Orders", paletteLabel: "Show Orders", icon: ArrowUpDown },
  { href: "/strategy", label: "STRATEGY", shortLabel: "Signals", paletteLabel: "Open Strategy", icon: Target },
  { href: "/research", label: "AI RESEARCH", shortLabel: "Research", paletteLabel: "Open AI Research", icon: BrainCircuit },
  { href: "/backtests", label: "BACKTESTS", shortLabel: "Backtests", paletteLabel: "Open Backtests", icon: Beaker },
  { href: "/journal", label: "JOURNAL", shortLabel: "Journal", paletteLabel: "Open Trade Journal", hint: "J", icon: BookOpen },
  { href: "/analytics", label: "ANALYTICS", shortLabel: "Analytics", paletteLabel: "Open Analytics", icon: BarChart3 },
  { href: "/alerts", label: "ALERTS", shortLabel: "Alerts", paletteLabel: "Open Alerts", hint: "A", icon: Bell },
  { href: "/automation", label: "AUTOMATION", shortLabel: "Automation", paletteLabel: "Open Automation", icon: Bot, tag: "OFF" },
  { href: "/ai-connection", label: "AI CONNECTION", shortLabel: "AI", paletteLabel: "Open AI Connection", icon: Bot },
  { href: "/settings", label: "SETTINGS", shortLabel: "Settings", paletteLabel: "Open Settings", icon: Settings },
];

/** Bottom-bar slots. Keep this to four so "More" stays reachable. */
export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) => item.mobile);

/** localStorage key for the manual sidebar choice (written by the store). */
export const SIDEBAR_STORAGE_KEY = "tc:sidebar-collapsed";

export function isNavActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
