"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { fmtCompactUsd, fmtDateTime } from "@/lib/format";

interface EquityPoint {
  time: number;
  equity: number;
}

/**
 * SVG equity curve. Deliberately plain: the app's candle
 * charts use TradingView Lightweight Charts, but an equity
 * curve is a single line, so a scoped SVG keeps the bundle
 * honest and the component dependency-free.
 */
export function EquityCurve({ data, height = 220 }: { data: EquityPoint[]; height?: number }) {
  useDisplayCurrency();
  if (!data || data.length < 2) {
    return (
      <p className="text-[11px] text-dim p-3">
        Equity curve needs at least two points (open and close a trade, or let the run mark-to-market).
      </p>
    );
  }

  const width = 720;
  const padL = 64;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const equities = data.map((d) => d.equity);
  const min = Math.min(...equities);
  const max = Math.max(...equities);
  const span = max - min || 1;
  const t0 = data[0].time;
  const t1 = data[data.length - 1].time;
  const tSpan = t1 - t0 || 1;

  const x = (t: number) => padL + ((t - t0) / tSpan) * plotW;
  const y = (v: number) => padT + plotH - ((v - min) / span) * plotH;

  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(d.time).toFixed(1)},${y(d.equity).toFixed(1)}`).join(" ");
  // Baseline at the starting equity, so drawdown below start is visible.
  const startY = y(data[0].equity);

  // A few y-axis ticks.
  const ticks = [min, min + span / 2, max];
  const ended = data[data.length - 1].equity;
  const start = data[0].equity;

  return (
    <div className="p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full block" role="img"
        aria-label={`Equity curve from ${fmtCompactUsd(start)} to ${fmtCompactUsd(ended)}`}>
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="var(--edge)" strokeWidth="1" strokeDasharray="2 4" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="var(--dim)" className="num">
              {fmtCompactUsd(t)}
            </text>
          </g>
        ))}
        {/* starting-equity reference */}
        <line x1={padL} x2={width - padR} y1={startY} y2={startY} stroke="var(--dim)" strokeWidth="1" opacity="0.5" />
        {/* the curve */}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        {/* x-axis time labels */}
        <text x={padL} y={height - 6} fontSize="9" fill="var(--dim)">{fmtDateTime(t0)}</text>
        <text x={width - padR} y={height - 6} fontSize="9" fill="var(--dim)" textAnchor="end">{fmtDateTime(t1)}</text>
      </svg>
      <div className="flex justify-between text-[9.5px] text-dim mt-1">
        <span>START {fmtCompactUsd(start)}</span>
        <span className={ended >= start ? "text-up" : "text-dn"}>
          END {fmtCompactUsd(ended)} ({ended >= start ? "+" : ""}{fmtCompactUsd(ended - start)})
        </span>
      </div>
    </div>
  );
}
