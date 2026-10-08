"use client";
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  Crosshair, Eye, EyeOff, Lock, LockOpen, Minus, MousePointer2,
  MoveUpRight, MoveVertical, Square, Target, Trash2, TrendingUp, Type,
} from "lucide-react";
import type {
  IPriceLine, ISeriesApi, SeriesMarker, Time as LTime,
} from "lightweight-charts";
import { api } from "@/lib/api";
import { cx } from "@/lib/format";
import { useApp } from "@/stores";
import type { Analysis, Candle, Drawing, DrawingType, Timeframe } from "@/lib/types";
import { DrawLayer, type HitResult } from "./drawLayer";

type Tool = "cursor" | DrawingType;

const TOOL_DEFS: { id: Tool; icon: typeof Minus; label: string }[] = [
  { id: "cursor", icon: MousePointer2, label: "Select / pan" },
  { id: "hline", icon: Minus, label: "Horizontal line" },
  { id: "trend", icon: TrendingUp, label: "Trend line" },
  { id: "ray", icon: MoveUpRight, label: "Ray" },
  { id: "rect", icon: Square, label: "Zone / rectangle" },
  { id: "vline", icon: MoveVertical, label: "Vertical line" },
  { id: "text", icon: Type, label: "Text label" },
  { id: "entry", icon: Crosshair, label: "Entry level" },
  { id: "stop", icon: Minus, label: "Stop level" },
  { id: "target", icon: Target, label: "Target level" },
];
const COLORS = ["#57E6D2", "#2FD388", "#F0524F", "#F5B84D", "#9AB2CE"];
const SINGLE_POINT: DrawingType[] = ["hline", "vline", "text", "entry", "stop", "target"];

export default function ChartPanel({
  symbol, timeframe, analysis, interactive = true, showObjectTree = false, className,
}: {
  symbol: string;
  timeframe: Timeframe;
  analysis?: Analysis | null;
  interactive?: boolean;
  showObjectTree?: boolean;
  className?: string;
}) {
  const { settings } = useApp();
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const [lastCandle, setLastCandle] = useState<Candle | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [tool, setTool] = useState<Tool>("cursor");
  const [color, setColor] = useState(COLORS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(showObjectTree);

  // refs mirroring state for event handlers
  const chartRef = useRef<never | null>(null);
  const seriesRef = useRef<never | null>(null);
  const volRef = useRef<never | null>(null);
  const markersRef = useRef<{ setMarkers: (m: SeriesMarker<LTime>[]) => void } | null>(null);
  const layerRef = useRef<DrawLayer | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const drawingsRef = useRef<Drawing[]>(drawings);
  const toolRef = useRef<Tool>(tool);
  const colorRef = useRef(color);
  const selectedRef = useRef<string | null>(selectedId);
  const draftRef = useRef<Drawing | null>(null);
  const lwcRef = useRef<typeof import("lightweight-charts") | null>(null);
  const redrawTimer = useRef<number | null>(null);

  const redraw = useCallback(() => {
    if (redrawTimer.current) return;
    redrawTimer.current = requestAnimationFrame(() => {
      redrawTimer.current = null;
      layerRef.current?.render(drawingsRef.current, draftRef.current, selectedRef.current);
    });
  }, []);

  useEffect(() => {
    drawingsRef.current = drawings;
    toolRef.current = tool;
    colorRef.current = color;
    selectedRef.current = selectedId;
  }, [drawings, tool, color, selectedId]);

  const applyCandles = useCallback((candles: Candle[]) => {
    const series = seriesRef.current as unknown as import("lightweight-charts").ISeriesApi<"Candlestick"> | null;
    const vol = volRef.current as unknown as import("lightweight-charts").ISeriesApi<"Histogram"> | null;
    if (!series || !vol) return;
    series.setData(candles.map((c) => ({ time: c.time as never, open: c.open, high: c.high, low: c.low, close: c.close })));
    vol.setData(candles.map((c) => ({
      time: c.time as never,
      value: c.volume,
      color: c.close >= c.open ? "rgba(47,211,136,0.25)" : "rgba(240,82,79,0.25)",
    })));
    redraw();
  }, [redraw]);

  /* ---------------- chart init ---------------- */
  useEffect(() => {
    let disposed = false;
    (async () => {
      const LWC = await import("lightweight-charts");
      if (disposed || !containerRef.current) return;
      lwcRef.current = LWC;
      const chart = LWC.createChart(containerRef.current, {
        autoSize: true,
        layout: {
          background: { type: LWC.ColorType.Solid, color: "transparent" },
          textColor: "#8B98A9",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
        },
        grid: {
          vertLines: { color: "rgba(148,163,184,0.05)" },
          horzLines: { color: "rgba(148,163,184,0.05)" },
        },
        crosshair: {
          mode: LWC.CrosshairMode.Normal,
          vertLine: { labelBackgroundColor: "#151B24" },
          horzLine: { labelBackgroundColor: "#151B24" },
        },
        rightPriceScale: { borderColor: "rgba(148,163,184,0.12)", scaleMargins: { top: 0.08, bottom: 0.24 } },
        timeScale: { borderColor: "rgba(148,163,184,0.12)", timeVisible: true, secondsVisible: false, rightOffset: 5 },
      });
      const series = chart.addSeries(LWC.CandlestickSeries, {
        upColor: "#2FD388", downColor: "#F0524F",
        wickUpColor: "#2FD388", wickDownColor: "#F0524F",
        borderVisible: false,
      });
      const vol = chart.addSeries(LWC.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
        lastValueVisible: false,
        priceLineVisible: false,
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

      chartRef.current = chart as never;
      seriesRef.current = series as never;
      volRef.current = vol as never;
      markersRef.current = LWC.createSeriesMarkers(series, []);
      layerRef.current = new DrawLayer(containerRef.current, chart, series);
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => redraw());
      chart.subscribeCrosshairMove((param) => {
        const d = param.seriesData.get(series) as Candle | undefined;
        setHover(d && d.close ? d : null);
      });
      setReady(true);
    })().catch(() => setError("Chart engine failed to initialise."));
    return () => {
      disposed = true;
      layerRef.current?.destroy();
      layerRef.current = null;
      (chartRef.current as unknown as { remove?: () => void } | null)?.remove?.();
      chartRef.current = null;
    };
  }, [redraw]);

  /* ---------------- candle data ---------------- */
  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const load = async () => {
      try {
        const res = await api.get<{ candles: Candle[]; source: "demo" | "live" }>(
          `/api/market/candles?symbol=${symbol}&timeframe=${timeframe}&limit=300`
        );
        if (stop) return;
        candlesRef.current = res.candles;
        setLastCandle(res.candles.at(-1) ?? null);
        applyCandles(res.candles);
        setError(res.source === "demo" && settings.dataSource === "live"
          ? "CoinDCX candles unavailable — showing demo data (labelled)."
          : null);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : "Candles unavailable");
      }
    };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => { stop = true; clearInterval(id); };
  }, [ready, symbol, timeframe, applyCandles, settings.dataSource]);

  /* ---------------- drawings load ---------------- */
  useEffect(() => {
    let stop = false;
    api.get<{ drawings: Drawing[] }>(`/api/drawings?symbol=${symbol}&timeframe=${timeframe}`)
      .then((res) => { if (!stop) setDrawings(res.drawings as Drawing[]); })
      .catch(() => undefined);
    return () => { stop = true; };
  }, [symbol, timeframe]);

  useEffect(() => { redraw(); }, [drawings, selectedId, redraw]);

  /* ---------------- price lines (levels, drawings, signal) ---------------- */
  useEffect(() => {
    const series = seriesRef.current as unknown as ISeriesApi<"Candlestick"> | null;
    const LWC = lwcRef.current;
    if (!series || !LWC) return;
    for (const l of linesRef.current) series.removePriceLine(l);
    linesRef.current = [];

    const add = (price: number, colorV: string, style: 0 | 1 | 2, title: string) => {
      if (!Number.isFinite(price) || price <= 0) return;
      linesRef.current.push(series.createPriceLine({
        price, color: colorV, lineWidth: 1, lineStyle: style,
        axisLabelVisible: true, title,
      }));
    };

    for (const d of drawingsRef.current) {
      if (d.hidden) continue;
      if (d.type === "hline") add(d.points[0]?.price ?? NaN, d.color, 0, d.label || "LEVEL");
      if (d.type === "entry") add(d.points[0]?.price ?? NaN, d.color, 0, d.label || "ENTRY");
      if (d.type === "stop") add(d.points[0]?.price ?? NaN, d.color, 2, d.label || "STOP");
      if (d.type === "target") add(d.points[0]?.price ?? NaN, d.color, 2, d.label || "TARGET");
    }

    if (analysis && settings.srAuto && settings.modules.supportResistance !== false) {
      for (const lvl of analysis.levels) {
        add(
          lvl.price,
          lvl.kind === "support" ? "rgba(47,211,136,0.55)" : "rgba(240,82,79,0.55)",
          2,
          `${lvl.kind === "support" ? "S" : "R"}·${lvl.touches}t ${Math.round(lvl.strength * 100)}%`
        );
      }
    }

    const primary = analysis?.signals.find((s) => s.entry !== null);
    if (primary) {
      if (primary.entry) add(primary.entry, "#57E6D2", 0, "ENTRY");
      if (primary.stop) add(primary.stop, "#F0524F", 2, "STOP");
      if (primary.target) add(primary.target, "#2FD388", 2, "TARGET");
    }
    redraw();
  }, [drawings, analysis, ready, settings.srAuto, settings.modules.supportResistance, redraw]);

  /* ---------------- markers (structure + signal) ---------------- */
  useEffect(() => {
    const series = seriesRef.current as unknown as ISeriesApi<"Candlestick"> | null;
    if (!series || !analysis || !markersRef.current) return;
    const markers: SeriesMarker<LTime>[] = [];
    if (settings.modules.marketStructure !== false) {
      for (const s of analysis.swings.slice(-6)) {
        const isHigh = s.kind === "HH" || s.kind === "LH";
        markers.push({
          time: s.time as never,
          position: isHigh ? "aboveBar" : "belowBar",
          color: isHigh ? "#9AB2CE" : "#5B6B80",
          shape: "circle",
          text: s.kind,
          size: 0.6,
        });
      }
    }
    const primary = analysis.signals.find((s) => s.entry !== null);
    const candles = candlesRef.current;
    if (primary && candles.length > 1) {
      const lastClosed = candles[candles.length - 2];
      markers.push({
        time: lastClosed.time as never,
        position: primary.status === "LONG_SETUP" ? "belowBar" : "aboveBar",
        color: primary.status === "LONG_SETUP" ? "#2FD388" : "#F0524F",
        shape: primary.status === "LONG_SETUP" ? "arrowUp" : "arrowDown",
        text: primary.status === "LONG_SETUP" ? "LONG SETUP" : "SHORT SETUP",
        size: 1.1,
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    markersRef.current?.setMarkers(markers);
  }, [analysis, ready, settings.modules.marketStructure]);

  /* ---------------- pointer interactions ---------------- */
  useEffect(() => {
    const el = containerRef.current;
    const layer = () => layerRef.current;
    if (!el || !ready) return;

    const pos = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { px: e.clientX - r.left, py: e.clientY - r.top };
    };

    const onDown = (e: PointerEvent) => {
      const L = layer();
      if (!L || !interactive) return;
      const { px, py } = pos(e);
      const currentTool = toolRef.current;

      if (currentTool === "cursor") {
        const hit = L.hitTest(px, py, drawingsRef.current);
        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          setSelectedId(hit.id);
          startDrag(hit, px, py);
        } else {
          setSelectedId(null);
        }
        return;
      }

      // creation tools take over the surface
      e.preventDefault();
      e.stopPropagation();
      const time = L.timeFromX(px);
      const price = L.priceFromY(py);
      if (price === null) return;
      const type = currentTool as DrawingType;
      if (SINGLE_POINT.includes(type)) {
        let label = "";
        if (type === "text") {
          const input = window.prompt("Label text", "note");
          if (input === null) return;
          label = input;
        }
        void commitDrawing({
          type,
          points: [{ time: time ?? Math.floor(Date.now() / 1000), price }],
          label,
        });
        setTool("cursor");
        return;
      }
      if (time === null) return;
      draftRef.current = baseDrawing(type, [{ time, price }, { time, price }]);
      redraw();

      const onMove = (ev: PointerEvent) => {
        const p = pos(ev);
        const t2 = L.timeFromX(p.px);
        const pr2 = L.priceFromY(p.py);
        if (!draftRef.current || t2 === null || pr2 === null) return;
        draftRef.current.points[1] = { time: t2, price: pr2 };
        redraw();
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const d = draftRef.current;
        draftRef.current = null;
        redraw();
        if (!d) return;
        const p = pos(ev);
        const t2 = L.timeFromX(p.px);
        const pr2 = L.priceFromY(p.py);
        if (t2 !== null && pr2 !== null) d.points[1] = { time: t2, price: pr2 };
        if (Math.abs(d.points[1].time - d.points[0].time) < 2 && Math.abs(d.points[1].price - d.points[0].price) < 1e-9) return;
        void commitDrawing({ type: d.type, points: d.points, label: "" });
        setTool("cursor");
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };

    function startDrag(hit: HitResult, startPx: number, startPy: number) {
      const L = layer();
      if (!L) return;
      const orig = drawingsRef.current.find((d) => d.id === hit.id);
      if (!orig) return;
      const points = orig.points.map((p) => ({ ...p }));
      const startTime = points[0].time;
      const startPrice = points[0].price;
      const moved: { time: number; price: number }[] = points.map((p) => ({ ...p }));

      const onMove = (ev: PointerEvent) => {
        const { px, py } = pos(ev);
        const t = L.timeFromX(px);
        const pr = L.priceFromY(py);
        if (pr === null) return;
        const isHLike = ["hline", "entry", "stop", "target"].includes(orig.type);
        if (hit.handle === 0 || hit.handle === 1) {
          if (isHLike) moved[hit.handle] = { time: moved[hit.handle].time, price: pr };
          else if (t !== null) moved[hit.handle] = { time: t, price: pr };
        } else if (hit.handle === "body" || hit.handle === null) {
          if (isHLike) {
            const np = pr;
            for (let i = 0; i < moved.length; i++) moved[i] = { ...moved[i], price: np };
          } else if (orig.type === "vline" && t !== null) {
            moved[0] = { time: t, price: moved[0].price };
          } else if (t !== null) {
            const dt = t - startTime;
            const dp = pr - startPrice;
            for (let i = 0; i < points.length; i++) {
              moved[i] = { time: points[i].time + dt, price: points[i].price + dp };
            }
          }
        }
        setDrawingsLive(orig.id ?? "", moved);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        void api.patch("/api/drawings", { id: orig.id, points: moved }).catch(() => undefined);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    }

    const onHoverMove = (e: PointerEvent) => {
      if (toolRef.current !== "cursor") return;
      const L = layer();
      if (!L) return;
      const { px, py } = pos(e);
      const hit = L.hitTest(px, py, drawingsRef.current);
      el.style.cursor = hit ? "move" : "";
    };

    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onHoverMove);
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointermove", onHoverMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, interactive]);

  function setDrawingsLive(id: string, points: { time: number; price: number }[]) {
    setDrawings((prev) => prev.map((d) => (d.id === id ? { ...d, points } : d)));
  }

  function baseDrawing(type: DrawingType, points: Drawing["points"]): Drawing {
    return {
      symbol, timeframe, layout: "default", type, points,
      color: colorRef.current, width: 2, opacity: 1,
      locked: false, hidden: false, label: "", note: "",
    };
  }

  async function commitDrawing(partial: { type: DrawingType; points: Drawing["points"]; label: string }) {
    const d = baseDrawing(partial.type, partial.points);
    d.label = partial.label;
    try {
      const res = await api.post<{ drawing: Drawing }>("/api/drawings", d);
      setDrawings((prev) => [...prev, res.drawing]);
    } catch { /* transient — object stays local until reload */ }
  }

  async function deleteDrawing(id: string) {
    setDrawings((prev) => prev.filter((d) => d.id !== id));
    if (selectedId === id) setSelectedId(null);
    await api.del(`/api/drawings?id=${id}`).catch(() => undefined);
  }

  async function patchDrawing(id: string, patch: Partial<Drawing>) {
    setDrawings((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    await api.patch("/api/drawings", { id, ...patch }).catch(() => undefined);
  }

  // Delete key removes the selected object
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (selectedRef.current) void deleteDrawing(selectedRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = hover ?? lastCandle;

  return (
    <div className={cx("flex min-h-0 h-full", className)}>
      {/* tool strip */}
      {interactive && (
        <div className="flex md:flex-col gap-1 p-1.5 border-r border-edge flex-none overflow-x-auto md:overflow-y-auto" role="toolbar" aria-label="Drawing tools">
          {TOOL_DEFS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                title={t.label}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                className={cx(
                  "p-1.5 rounded flex-none",
                  tool === t.id ? "bg-accent-dim text-accent" : "text-dim hover:text-ink hover:bg-panel2"
                )}
              >
                <Icon size={14} />
              </button>
            );
          })}
          <div className="hidden md:block border-t border-edge my-1 mx-1" />
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              className={cx("w-5 h-5 rounded-full flex-none m-0.5 border-2", color === c ? "border-ink" : "border-transparent")}
              style={{ backgroundColor: c }}
            />
          ))}
          <div className="hidden md:block border-t border-edge my-1 mx-1" />
          <button
            onClick={() => selectedId && void deleteDrawing(selectedId)}
            disabled={!selectedId}
            title="Delete selected (Del)"
            aria-label="Delete selected drawing"
            className="p-1.5 rounded text-dim hover:text-dn disabled:opacity-30 flex-none"
          >
            <Trash2 size={14} />
          </button>
          {showObjectTree && (
            <button
              onClick={() => setTreeOpen((o) => !o)}
              title="Chart objects"
              aria-label="Toggle chart objects panel"
              className={cx("p-1.5 rounded flex-none md:mt-auto", treeOpen ? "text-accent bg-accent-dim" : "text-dim hover:text-ink")}
            >
              <Eye size={14} />
            </button>
          )}
        </div>
      )}

      {/* chart surface */}
      <div className="flex-1 min-w-0 relative">
        <div ref={containerRef} className="absolute inset-0" />
        {/* OHLC legend */}
        <div className="absolute top-1.5 left-2 z-10 pointer-events-none flex items-center gap-2 text-[10px] num">
          <span className="text-mut">{symbol} · {timeframe}</span>
          {shown && (
            <span className="text-dim hidden sm:inline">
              O <span className={shown.close >= shown.open ? "text-up" : "text-dn"}>{shown.open}</span>{" "}
              H <span className={shown.close >= shown.open ? "text-up" : "text-dn"}>{shown.high}</span>{" "}
              L <span className={shown.close >= shown.open ? "text-up" : "text-dn"}>{shown.low}</span>{" "}
              C <span className={shown.close >= shown.open ? "text-up" : "text-dn"}>{shown.close}</span>
            </span>
          )}
          {settings.dataSource === "demo" && <span className="text-warn/80 text-[9px]">DEMO DATA</span>}
        </div>
        {error && (
          <div className="absolute top-1.5 right-2 z-10 text-[10px] text-warn bg-warn/10 border border-warn/30 rounded px-2 py-0.5">
            {error}
          </div>
        )}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="microlabel pulse-soft">LOADING CHART ENGINE…</p>
          </div>
        )}
        <div className="absolute bottom-0.5 right-2 z-10 pointer-events-none text-[8px] text-dim/70">
          Powered by TradingView Lightweight Charts
        </div>
      </div>

      {/* object tree */}
      {treeOpen && interactive && (
        <ObjectTree
          drawings={drawings}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onPatch={patchDrawing}
          onDelete={deleteDrawing}
        />
      )}
    </div>
  );
}

/* ================= object tree ================= */

function ObjectTree({
  drawings, selectedId, onSelect, onPatch, onDelete,
}: {
  drawings: Drawing[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<Drawing>) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <aside className="w-52 border-l border-edge flex flex-col flex-none min-h-0" aria-label="Chart objects">
      <p className="microlabel px-2.5 h-8 flex items-center border-b border-edge">CHART OBJECTS</p>
      <div className="flex-1 overflow-y-auto p-1.5">
        {drawings.length === 0 && (
          <p className="text-[10px] text-dim px-2 py-4 leading-relaxed">
            No chart objects yet. Pick a tool on the left and draw directly on the chart.
          </p>
        )}
        {drawings.map((d) => (
          <div
            key={d.id}
            className={cx(
              "rounded px-1.5 py-1 mb-1 cursor-pointer border",
              selectedId === d.id ? "border-accent/40 bg-accent-dim" : "border-transparent hover:bg-panel2"
            )}
            onClick={() => onSelect(d.id ?? null)}
          >
            <div className="flex items-center gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); onPatch(d.id!, { hidden: !d.hidden }); }}
                aria-label={d.hidden ? "Show object" : "Hide object"}
                className="text-dim hover:text-ink"
              >
                {d.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onPatch(d.id!, { locked: !d.locked }); }}
                aria-label={d.locked ? "Unlock object" : "Lock object"}
                className={d.locked ? "text-warn" : "text-dim hover:text-ink"}
              >
                {d.locked ? <Lock size={11} /> : <LockOpen size={11} />}
              </button>
              {editing === d.id ? (
                <input
                  autoFocus
                  defaultValue={d.label}
                  onBlur={(e) => { onPatch(d.id!, { label: e.target.value }); setEditing(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  className="bg-bg2 border border-edge rounded px-1 h-5 text-[10px] w-full outline-none"
                  aria-label="Object label"
                />
              ) : (
                <button
                  onDoubleClick={(e) => { e.stopPropagation(); setEditing(d.id!); }}
                  className="text-[10px] text-mut truncate flex-1 text-left"
                  title="Double-click to rename"
                >
                  {d.label || d.type.toUpperCase()}
                </button>
              )}
              <span className="text-[8px] num text-dim">{d.points[0]?.price?.toFixed?.(1)}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(d.id!); }}
                aria-label="Delete object"
                className="text-dim hover:text-dn"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-dim px-2.5 py-1.5 border-t border-edge">
        Persisted per symbol + timeframe
      </p>
    </aside>
  );
}
