/** Dark terminal palette, matching the web workstation's intent. */
export const colors = {
  bg: "#080d12",
  surface: "#101820",
  surfaceAlt: "#16212c",
  border: "#22303d",
  text: "#e7eef6",
  muted: "#93a3b4",
  dim: "#61717f",
  accent: "#2dd4bf",
  positive: "#34d399",
  negative: "#f87171",
  warning: "#fbbf24",
  paper: "#38bdf8",
  live: "#f87171",
  readonly: "#94a3b8",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const font = {
  mono: "Courier",
} as const;
