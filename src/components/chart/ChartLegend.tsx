"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { ChevronDown, Tags } from "lucide-react";
import { useState } from "react";
import { cx, fmtPrice } from "@/lib/format";
import { HelpTip } from "@/components/ui";
import {
  CANDLE_FIELDS, STRUCTURE_TERMS, groupLegendRows, type LabelMode, type LegendRow,
} from "./labels";

const SWATCH: Record<LegendRow["kind"], string> = {
  support: "bg-up",
  resistance: "bg-dn",
  "chandelier-long": "bg-up/70",
  "chandelier-short": "bg-dn/70",
  donchian: "bg-accent/70",
  signal: "bg-accent",
  drawing: "bg-mut",
};

/**
 * Legend that decodes everything drawn on the chart.
 *
 * The brief: if a chart shows an abbreviation, the user must be able to see its
 * full form. The legend always spells labels out, shows the compact token that
 * appears on the price axis next to it, and collapses so it never fights the
 * candles for space.
 */
export default function ChartLegend({
  rows, mode, onModeChange, hiddenCount = 0, defaultOpen = true,
}: {
  rows: LegendRow[];
  mode: LabelMode;
  onModeChange: (mode: LabelMode) => void;
  hiddenCount?: number;
  /** Small screens start collapsed so the candles keep their room. */
  defaultOpen?: boolean;
}) {
  useDisplayCurrency();
  const [open, setOpen] = useState(defaultOpen);
  const groups = groupLegendRows(rows);

  return (
    <div className="border-t border-edge bg-panel/80 flex-none">
      <div className="flex items-center gap-2 px-2.5 min-h-8">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-[10px] text-mut hover:text-ink"
        >
          <ChevronDown size={12} className={cx("transition-transform", !open && "-rotate-90")} />
          <span className="microlabel">WHAT IS ON THIS CHART</span>
          <span className="text-dim num">{groups.length} concepts</span>
        </button>

        <span className="ml-auto flex items-center gap-2">
          {hiddenCount > 0 && (
            <span className="text-[10px] text-dim num hidden sm:inline">{hiddenCount} hidden</span>
          )}
          <span className="text-[10px] text-dim hidden sm:inline">Price-axis labels:</span>
          <button
            type="button"
            role="switch"
            aria-checked={mode === "full"}
            aria-label="Use full indicator names on the price axis"
            title="Switch price-axis labels between short tokens and full names"
            onClick={() => onModeChange(mode === "full" ? "compact" : "full")}
            className={cx(
              "inline-flex items-center gap-1.5 h-6 px-2 rounded border text-[10px] transition-colors",
              mode === "full"
                ? "border-accent/50 bg-accent-dim text-accent"
                : "border-edge text-mut hover:text-ink"
            )}
          >
            <Tags size={11} />
            {mode === "full" ? "FULL NAMES" : "SHORT"}
          </button>
        </span>
      </div>

      {open && (
        /* Capped and scrollable: a chart with many levels must not push the
           candles off the pane. */
        <div className="px-2.5 pb-2.5 max-h-28 sm:max-h-44 overflow-y-auto grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-x-5 gap-y-1.5">
          {rows.length === 0 && (
            <p className="text-[10.5px] text-dim">
              No overlays are drawn. Enable structure, support/resistance or the strategy overlay to see them decoded here.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.key} className="min-w-0 text-[10.5px]">
              <div className="flex items-start gap-2">
                <span className={cx("w-2.5 h-2.5 rounded-sm flex-none mt-1", SWATCH[group.rows[0].kind])} aria-hidden />
                <span className="text-mut leading-snug">{group.label}</span>
                {group.rows[0].help && <HelpTip topic={group.rows[0].help} />}
              </div>
              <div className="pl-4 mt-0.5 flex flex-wrap gap-x-3 gap-y-1 num text-[10px] text-ink">
                {group.rows.map(row => <span key={row.id} title={row.detail ?? row.label}>
                  {group.rows.length > 1 ? `${row.token ?? "level"}: ` : ""}{row.value === null ? "—" : fmtPrice(row.value)}
                </span>)}
              </div>
            </div>
          ))}

          <div className="col-span-full mt-1 pt-2 border-t border-edge/60 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
            <p className="text-[10px] text-dim leading-snug">
              <span className="text-mut">Candle fields:</span>{" "}
              {CANDLE_FIELDS.map((f) => `${f.token} = ${f.meaning.split(" — ")[0]}`).join(" · ")}
            </p>
            <p className="text-[10px] text-dim leading-snug">
              <span className="text-mut">Structure markers:</span>{" "}
              {STRUCTURE_TERMS.map((s) => `${s.token} = ${s.meaning.split(" — ")[0]}`).join(" · ")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
