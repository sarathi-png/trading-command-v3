/**
 * Chart label vocabulary.
 *
 * Every abbreviation the chart can draw is defined here, with a compact form
 * (fits the price axis) and a full form (readable by a person who has never
 * seen the indicator). The chart uses compact by default and switches to full
 * names on request, so a label never has to be guessed.
 */

export interface LabelForms {
  /** Short token drawn next to the price axis. */
  compact: string;
  /** Full, self-explanatory name (used in the legend). */
  full: string;
  /**
   * Full words for the price axis. Shorter than `full` because several lines
   * can sit near the same price: words must stay readable without the axis
   * titles stacking on top of each other.
   */
  axisFull?: string;
  /** Optional longer explanation for the legend. */
  detail?: string;
}

export const SUPPORT: LabelForms = {
  compact: "S",
  full: "SUPPORT",
  detail: "A price area where buying has previously stopped a fall (detected from swing lows).",
};

export const RESISTANCE: LabelForms = {
  compact: "R",
  full: "RESISTANCE",
  detail: "A price area where selling has previously stopped a rise (detected from swing highs).",
};

export const ENTRY: LabelForms = { compact: "ENTRY", full: "ENTRY (signal price)", axisFull: "ENTRY" };
export const STOP: LabelForms = { compact: "STOP", full: "STOP (exit if wrong)", axisFull: "STOP" };
export const TARGET: LabelForms = { compact: "TARGET", full: "TARGET (planned profit level)", axisFull: "TARGET" };

export const CHANDELIER_LONG: LabelForms = {
  compact: "CD:CH-LONG",
  full: "CHANDELIER EXIT · LONG TRAILING STOP",
  axisFull: "CHANDELIER LONG STOP",
  detail: "Trailing stop for a long position: recent high minus ATR × multiplier.",
};

export const CHANDELIER_SHORT: LabelForms = {
  compact: "CD:CH-SHORT",
  full: "CHANDELIER EXIT · SHORT TRAILING STOP",
  axisFull: "CHANDELIER SHORT STOP",
  detail: "Trailing stop for a short position: recent low plus ATR × multiplier.",
};

export function donchianBound(period: number, bound: "upper" | "lower"): LabelForms {
  return {
    compact: `CD:D${period}-${bound === "upper" ? "U" : "L"}`,
    full: `DONCHIAN ${period} · ${bound === "upper" ? "UPPER" : "LOWER"} BOUND`,
    axisFull: `DONCHIAN ${period} ${bound === "upper" ? "UPPER" : "LOWER"}`,
    detail:
      bound === "upper"
        ? `Highest high of the ${period} candles before the current one — the level active Donchian breakouts clear.`
        : `Lowest low of the ${period} candles before the current one — the level active Donchian breakdowns lose.`,
  };
}

/** Structure marker abbreviations drawn above/below candles. */
export const STRUCTURE_TERMS: { token: string; meaning: string }[] = [
  { token: "HH", meaning: "Higher High — the market made a higher peak than the previous peak (bullish structure)." },
  { token: "HL", meaning: "Higher Low — it also held a higher trough (bullish structure)." },
  { token: "LH", meaning: "Lower High — the peak was lower than the previous peak (bearish structure)." },
  { token: "LL", meaning: "Lower Low — the trough was lower than the previous trough (bearish structure)." },
];

/** OHLC legend abbreviations. */
export const CANDLE_FIELDS: { token: string; meaning: string }[] = [
  { token: "O", meaning: "Open — the first traded price of the candle." },
  { token: "H", meaning: "High — the highest price during the candle." },
  { token: "L", meaning: "Low — the lowest price during the candle." },
  { token: "C", meaning: "Close — the last traded price of the candle." },
];

export type LabelMode = "compact" | "full";

/**
 * Compose a support/resistance price-line title.
 * `full` keeps the meaning ("SUPPORT") instead of a single letter.
 */
export function levelTitle(
  kind: "support" | "resistance",
  touches: number,
  strengthPct: number,
  mode: LabelMode
): string {
  const base = kind === "support" ? SUPPORT : RESISTANCE;
  const facts = `${touches} touch${touches === 1 ? "" : "es"} · ${strengthPct}% strength`;
  return mode === "full"
    ? `${base.full} · ${facts}`
    : `${base.compact}·${touches}t ${strengthPct}%`;
}

export function drawingTitle(type: string, label: string, mode: LabelMode): string {
  if (label) return label;
  switch (type) {
    case "hline": return mode === "full" ? "HORIZONTAL LEVEL" : "LEVEL";
    case "entry": return ENTRY.full;
    case "stop": return STOP.full;
    case "target": return TARGET.full;
    case "vline": return "VERTICAL LINE";
    case "text": return "TEXT NOTE";
    default: return "LEVEL";
  }
}

/**
 * One legend row: what is drawn, in full words, with the colour used on chart.
 */
export interface LegendRow {
  id: string;
  kind: "support" | "resistance" | "chandelier-long" | "chandelier-short" | "donchian" | "signal" | "drawing";
  /** Full-form label, always shown in the legend. */
  label: string;
  /** Compact token as drawn on the price axis, shown alongside it. */
  token?: string;
  value: number | null;
  detail?: string;
  help?: string;
}

/** Decode a concept once; retain its individual plotted values below it. */
export function groupLegendRows(rows: LegendRow[]): { key: string; label: string; rows: LegendRow[] }[] {
  const groups = new Map<string, { key: string; label: string; rows: LegendRow[] }>();
  for (const row of rows) {
    const key = row.kind === "donchian" ? (row.token?.endsWith("-U") ? "donchian-upper" : "donchian-lower")
      : row.kind === "signal" || row.kind === "drawing" ? `${row.kind}:${row.token ?? row.label}` : row.kind;
    const label = key === "donchian-upper" ? "DONCHIAN UPPER BOUND — highest prior high"
      : key === "donchian-lower" ? "DONCHIAN LOWER BOUND — lowest prior low"
      : key === "resistance" ? "R = RESISTANCE — area of previous selling"
      : key === "support" ? "S = SUPPORT — area of previous buying"
      : row.label;
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Equal Donchian bounds are one plotted level, not stacked duplicate badges. */
export function groupDonchianBounds(periods: Record<number, { upper: number; lower: number }>): { bound: "upper" | "lower"; price: number; periods: number[] }[] {
  const groups = new Map<string, { bound: "upper" | "lower"; price: number; periods: number[] }>();
  for (const [period, row] of Object.entries(periods)) {
    for (const bound of ["upper", "lower"] as const) {
      const price = row[bound];
      if (!Number.isFinite(price) || price <= 0) continue;
      const key = `${bound}:${price}`;
      const group = groups.get(key) ?? { bound, price, periods: [] };
      group.periods.push(Number(period));
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(group => ({ ...group, periods: group.periods.sort((a,b) => a-b) }));
}
