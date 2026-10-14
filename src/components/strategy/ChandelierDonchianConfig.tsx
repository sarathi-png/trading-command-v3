"use client";
import { useState } from "react";
import { Settings2 } from "lucide-react";
import { Chip, Input, PremiumPanel, Select, ToggleSwitch } from "@/components/ui";
import type { ChandelierDonchianConfig } from "@/lib/strategy/v2/types";

interface ChandelierDonchianConfigProps {
  config: ChandelierDonchianConfig;
  onChange: (config: ChandelierDonchianConfig) => void;
  className?: string;
}

export function ChandelierDonchianConfig({ config, onChange, className }: ChandelierDonchianConfigProps) {
  const [activeTab, setActiveTab] = useState<"risk" | "indicators" | "advanced">("risk");

  return (
    <PremiumPanel
      title="STRATEGY CONFIG"
      className={className}
      badge={<Chip tone="accent"><Settings2 size={11} /> CONFIG</Chip>}
      elevation={1}
    >
      <div className="p-3 space-y-3">
        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-edge pb-2">
          {(["risk", "indicators", "advanced"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2.5 h-7 text-[10px] tracking-wide border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? "border-accent text-ink"
                  : "border-transparent text-dim hover:text-mut"
              }`}
            >
              {tab.toUpperCase()}
            </button>
          ))}
        </div>

        {activeTab === "risk" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="microlabel">LEVERAGE (×)</span>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={config.risk.leverage}
                  onChange={(e) => onChange({
                    ...config,
                    risk: { ...config.risk, leverage: parseInt(e.target.value, 10) || 10 },
                  })}
                />
              </label>
              <label className="block space-y-1">
                <span className="microlabel">RISK % PER TRADE</span>
                <Input
                  type="number"
                  step="0.1"
                  min="0.1"
                  max="5"
                  value={config.risk.riskPct}
                  onChange={(e) => onChange({
                    ...config,
                    risk: { ...config.risk, riskPct: parseFloat(e.target.value) || 1.0 },
                  })}
                />
              </label>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-mut">Position sizing mode</span>
              <div className="flex border border-edge overflow-hidden">
                <button
                  onClick={() => onChange({ ...config, risk: { ...config.risk, mode: "auto" } })}
                  className={`px-3 min-h-6 text-[10px] tracking-wide ${
                    config.risk.mode === "auto" ? "bg-accent text-bg font-semibold" : "text-dim hover:text-ink"
                  }`}
                >AUTO</button>
                <button
                  onClick={() => onChange({ ...config, risk: { ...config.risk, mode: "manual" } })}
                  className={`px-3 min-h-6 text-[10px] tracking-wide ${
                    config.risk.mode === "manual" ? "bg-accent text-bg font-semibold" : "text-dim hover:text-ink"
                  }`}
                >MANUAL</button>
              </div>
            </div>

            {config.risk.mode === "manual" && (
              <label className="block space-y-1">
                <span className="microlabel">LOT SIZE (CONTRACTS)</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={config.risk.lotSize ?? ""}
                  placeholder="Enter lot size"
                  onChange={(e) => onChange({
                    ...config,
                    risk: { ...config.risk, lotSize: parseFloat(e.target.value) || null },
                  })}
                />
              </label>
            )}

            <label className="block space-y-1">
              <span className="microlabel">MAX CONCURRENT POSITIONS</span>
              <Input
                type="number"
                min={1}
                max={5}
                value={config.risk.maxPositions}
                onChange={(e) => onChange({
                  ...config,
                  risk: { ...config.risk, maxPositions: parseInt(e.target.value, 10) || 1 },
                })}
              />
            </label>

            <p className="text-[9.5px] text-dim leading-snug">
              AUTO sizing uses risk % × equity ÷ (entry − stop). MANUAL overrides with fixed lot size.
            </p>
          </div>
        )}

        {activeTab === "indicators" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="microlabel">CHANDELIER ATR LENGTH</span>
                <Input
                  type="number"
                  min={5}
                  max={50}
                  value={config.chandelier.atrLength}
                  onChange={(e) => onChange({
                    ...config,
                    chandelier: { ...config.chandelier, atrLength: parseInt(e.target.value, 10) || 20 },
                  })}
                />
              </label>
              <label className="block space-y-1">
                <span className="microlabel">CHANDELIER MULTIPLIER</span>
                <Input
                  type="number"
                  step="0.1"
                  min="0.5"
                  max="10"
                  value={config.chandelier.multiplier}
                  onChange={(e) => onChange({
                    ...config,
                    chandelier: { ...config.chandelier, multiplier: parseFloat(e.target.value) || 3.0 },
                  })}
                />
              </label>
            </div>

            <div className="border-t border-edge pt-2">
              <p className="microlabel mb-1.5">DONCHIAN PERIODS</p>
              <div className="flex flex-wrap gap-1.5">
                {[20, 50, 100, 200].map((p) => {
                  const enabled = config.donchian.periods.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => {
                        const periods = enabled
                          ? config.donchian.periods.filter((x) => x !== p)
                          : [...config.donchian.periods, p].sort((a, b) => a - b);
                        onChange({ ...config, donchian: { ...config.donchian, periods } });
                      }}
                      className={`h-6 px-2.5 rounded border text-[10px] num transition-colors ${
                        enabled
                          ? "border-accent/60 text-accent bg-accent-dim"
                          : "border-edge text-dim hover:text-ink"
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9.5px] text-dim mt-1">
                All selected periods must align for a trend signal.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-mut">Use Heikin Ashi candles</span>
              <ToggleSwitch
                checked={config.heikinAshi}
                onChange={(v) => onChange({ ...config, heikinAshi: v })}
              />
            </div>
          </div>
        )}

        {activeTab === "advanced" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-mut">Enable time stop</span>
              <ToggleSwitch
                checked={config.timeStop.enabled}
                onChange={(v) => onChange({
                  ...config,
                  timeStop: { ...config.timeStop, enabled: v },
                })}
              />
            </div>

            {config.timeStop.enabled && (
              <label className="block space-y-1">
                <span className="microlabel">TIME STOP (BARS)</span>
                <Select
                  value={String(config.timeStop.bars)}
                  onChange={(e) => onChange({
                    ...config,
                    timeStop: { ...config.timeStop, bars: parseInt(e.target.value, 10) || 48 },
                  })}
                >
                  <option value="24">24 bars (2 hours)</option>
                  <option value="48">48 bars (4 hours)</option>
                  <option value="96">96 bars (8 hours)</option>
                  <option value="144">144 bars (12 hours)</option>
                  <option value="288">288 bars (24 hours)</option>
                </Select>
              </label>
            )}

            <p className="text-[9.5px] text-dim leading-snug">
              Time stop closes the position after N bars if neither stop nor target is hit.
              Prevents indefinite holding in ranging markets.
            </p>
          </div>
        )}
      </div>
    </PremiumPanel>
  );
}