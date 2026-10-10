import type { Candle } from "@/lib/types";
import { runTrend, runRandomControl, report, type BacktestConfig, type Trade } from "./walkForward";
import { DEFAULT_TREND, type TrendParams } from "./trend";

export function paramGrid(base: TrendParams = DEFAULT_TREND): TrendParams[] {
  const out: TrendParams[] = [];
  for (const donchian of [20, 55])
    for (const stopAtr of [2, 3])
      for (const trailAtr of [3, 4])
        for (const regimeSma of [100, 200])
          out.push({ ...base, donchian, stopAtr, trailAtr, regimeSma });
  return out; // 16 configurations = number of trials for the DSR
}

/** Slice an LTF range and the HTF candles that are fully closed inside it (plus regime warm-up). */
export function sliceWindow(
  ltf: Candle[], htf: Candle[], a: number, b: number, cfg: BacktestConfig
): { ltf: Candle[]; htf: Candle[] } {
  const sub = ltf.slice(a, b);
  const startT = sub[0].time - cfg.htfSec * (cfg.params.regimeSma + 5);
  const endT = sub[sub.length - 1].time + cfg.ltfSec;
  return { ltf: sub, htf: htf.filter((c) => c.time >= startT && c.time + cfg.htfSec <= endT) };
}