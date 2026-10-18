/**
 * Visual language of the mobile app.
 *
 * The desktop terminal is a dark, low-clutter workspace, so the phone app
 * keeps the same palette: near-black background, one accent, and a strict
 * green/red convention for gain and loss.
 */
export const theme = {
  bg: "#0b0e14",
  panel: "#131722",
  panelAlt: "#171b26",
  border: "#22262f",
  borderSoft: "#1a1e27",
  text: "#e6e9f0",
  textDim: "#9aa3b2",
  textFaint: "#6b7280",
  accent: "#3d7eff",
  accentSoft: "#1b2b4d",
  up: "#26a69a",
  down: "#ef5350",
  upSoft: "#12302d",
  downSoft: "#3a1d1d",
  warn: "#f0b90b",
  warnSoft: "#3a2f0d",
  chip: "#1b1f2a",
  chipActive: "#2b4a8f",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

export const font = {
  mono: "JetBrains Mono",
} as const;

/** Colour for a signed number, using the app's gain/loss convention. */
export function signColor(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return theme.textDim;
  if (value > 0) return theme.up;
  if (value < 0) return theme.down;
  return theme.textDim;
}

/** Format a number with thousands separators and a fixed precision. */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Format a signed percentage, e.g. "+1.24%". */
export function formatPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** Format a signed money amount, e.g. "-12.40". */
export function formatMoney(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, digits)}`;
}
