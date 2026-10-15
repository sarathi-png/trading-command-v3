import { currentDisplayCurrency, currencySymbol, displayRate } from "./displayCurrency";
/** Formatting helpers. All timestamps are stored UTC; display converts. */

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function fmtUsd(n: number | null | undefined, opts?: { sign?: boolean; decimals?: number }): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  n *= displayRate();
  const d = opts?.decimals ?? (Math.abs(n) >= 1000 ? 0 : 2);
  const abs = Math.abs(n).toLocaleString(currentDisplayCurrency().displayCurrency === "inr" ? "en-IN" : "en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  const sign = n < 0 ? "-" : opts?.sign && n > 0 ? "+" : "";
  return `${sign}${currencySymbol()}${abs}`;
}

export function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  n *= displayRate();
  const decimals = Math.abs(n) >= 10000 ? 1 : Math.abs(n) >= 100 ? 2 : Math.abs(n) >= 1 ? 3 : 5;
  return `${currentDisplayCurrency().displayCurrency === "inr" ? "₹" : ""}${fmtNum(n, decimals)}`;
}

export function fmtPct(n: number | null | undefined, opts?: { sign?: boolean; decimals?: number }): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  const sign = n > 0 && opts?.sign !== false ? "+" : "";
  return `${sign}${n.toFixed(opts?.decimals ?? 2)}%`;
}

export function fmtCompactUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "N/A";
  n *= displayRate();
  const symbol = currencySymbol();
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${symbol}${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${symbol}${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${symbol}${(n / 1e3).toFixed(1)}K`;
  return `${symbol}${n.toFixed(0)}`;
}

const TZ_MAP: Record<string, string | undefined> = {
  IST: "Asia/Kolkata",
  UTC: "UTC",
  local: undefined,
};

export function fmtTime(tsMs: number, tz: string = "IST", withSeconds = false): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: withSeconds ? "2-digit" : undefined,
      timeZone: TZ_MAP[tz],
      hour12: false,
    }).format(new Date(tsMs));
  } catch {
    return new Date(tsMs).toUTCString().slice(17, 25);
  }
}

export function fmtDateTime(tsMs: number, tz: string = "IST"): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: TZ_MAP[tz],
      hour12: false,
    }).format(new Date(tsMs));
  } catch {
    return new Date(tsMs).toISOString();
  }
}

export function fmtDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function pnlTone(v: number): "pos" | "neg" | "flat" {
  if (v > 0) return "pos";
  if (v < 0) return "neg";
  return "flat";
}
