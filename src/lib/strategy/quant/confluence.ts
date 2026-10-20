/**
 * Confluence scorer — faithful port of trader_bot_v2/engine/confluence.py.
 *
 * Four signed components in [-1,+1] with weights 0.35/0.25/0.25/0.15,
 * score = round(50*(1+net), 1), direction threshold 0.15, gate min_score 55.
 *
 * Components:
 *  - trend   = clip(0.7 * emaComponent + 0.3 * swingStructureSign)
 *  - zone    = clip(longScore - shortScore)  (wick-rejection scoring with decay)
 *  - momentum= clip(0.6 * clip((rsi-50)/20) + 0.4 * clip(ema9 3-bar slope/atr))
 *  - volume  = clip(max(0, ratio-1)) * sign(momentum)
 */
import type { Candle } from "@/lib/types";
import { atr, closes, ema, rsi } from "../../indicators";
import { supportResZones, trendDirection } from "./zones";

export interface ConfluenceConfig {
  weightTrend: number; weightZone: number; weightMomentum: number; weightVolume: number;
  htfEmaFast: number; htfEmaSlow: number; momEma: number; rsiPeriod: number;
  swingN: number; zoneTolerancePct: number; zoneAtrMult: number; wickMinRatio: number;
  directionThreshold: number; minScore: number; vetoOpposite: boolean;
}

export const DEFAULT_CONFIG: ConfluenceConfig = {
  weightTrend: 0.35, weightZone: 0.25, weightMomentum: 0.25, weightVolume: 0.15,
  htfEmaFast: 20, htfEmaSlow: 50, momEma: 9, rsiPeriod: 14,
  swingN: 5, zoneTolerancePct: 0.003, zoneAtrMult: 0.6, wickMinRatio: 0.45,
  directionThreshold: 0.15, minScore: 55, vetoOpposite: true,
};

const MIN_BARS = 40;

export interface ConfluenceResult {
  score: number; direction: "LONG" | "SHORT" | "NEUTRAL";
  components: { trend: number; zone: number; momentum: number; volume: number };
  reasons: string[];
  atr: number | null;
  htfSupport: number | null;
  htfResistance: number | null;
}

const clip = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const p2 = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(2);

function neutral(reason: string): ConfluenceResult {
  return {
    score: 50, direction: "NEUTRAL",
    components: { trend: 0, zone: 0, momentum: 0, volume: 0 },
    reasons: [reason], atr: null, htfSupport: null, htfResistance: null,
  };
}

function trendComponent(htf: Candle[], cfg: ConfluenceConfig): { comp: number; reason: string } {
  const hc = closes(htf);
  const fast = ema(hc, cfg.htfEmaFast);
  const slow = ema(hc, cfg.htfEmaSlow);
  const hatr = atr(htf);
  const i = htf.length - 1;
  const atrLast = hatr[i];
  if (atrLast === null || atrLast <= 0) {
    return { comp: 0, reason: "trend=+0.00 (htf ATR unavailable)" };
  }
  const fastLast = fast[i];
  const slowLast = slow[i];
  if (fastLast === null || slowLast === null) {
    return { comp: 0, reason: "trend=+0.00 (htf EMA warmup)" };
  }
  const sep = fastLast - slowLast;
  const amp = clip(Math.abs(sep) / (0.5 * atrLast), 0, 1);
  const emaComp = sgn(sep) * amp;
  const structure = trendDirection(htf, cfg.swingN);
  const swingSign = structure === "uptrend" ? 1 : structure === "downtrend" ? -1 : 0;
  const comp = clip(0.7 * emaComp + 0.3 * swingSign);
  const gapAtr = sep / atrLast;
  return {
    comp,
    reason: `trend=${p2(comp)} (ema_gap=${p2(gapAtr)}atr ${cfg.htfEmaFast}g${cfg.htfEmaSlow}, structure=${structure})`,
  };
}

function zoneComponent(ltf: Candle[], cfg: ConfluenceConfig, atrLast: number): { comp: number; reason: string } {
  const { supZones, resZones } = supportResZones(ltf, cfg.swingN, cfg.zoneTolerancePct);
  const closeLast = ltf[ltf.length - 1].close;

  let support: number | null = null;
  let supDist = Infinity;
  for (const z of supZones) {
    const d = Math.abs(closeLast - z.high);
    if (d < supDist) { supDist = d; support = z.high; }
  }
  let resistance: number | null = null;
  let resDist = Infinity;
  for (const z of resZones) {
    const d = Math.abs(closeLast - z.low);
    if (d < resDist) { resDist = d; resistance = z.low; }
  }

  const decays = [1.0, 0.7, 0.5];
  let longScore = 0;
  let longNote = "";
  if (support !== null) {
    if (closeLast < support - 0.2 * atrLast) {
      longScore = -0.6;
      longNote = `support ${support.toPrecision(8)} broken (-0.60)`;
    } else if (Math.abs(closeLast - support) <= cfg.zoneAtrMult * atrLast) {
      let best = 0;
      for (let age = 0; age < decays.length; age++) {
        const bar = ltf[ltf.length - 1 - age];
        const rng = bar.high - bar.low;
        if (rng <= 0) continue;
        const lowerRatio = (Math.min(bar.open, bar.close) - bar.low) / rng;
        const touched = bar.low <= support + 0.15 * atrLast;
        const reclaimed = bar.close > support;
        if (touched && reclaimed && lowerRatio >= cfg.wickMinRatio) {
          best = Math.max(best, clip(lowerRatio, 0, 1) * decays[age]);
        }
      }
      if (best > 0) {
        longScore = best;
        longNote = `bullish wick rejection at support ${support.toPrecision(8)}`;
      }
    }
  }

  let shortScore = 0;
  let shortNote = "";
  if (resistance !== null) {
    if (closeLast > resistance + 0.2 * atrLast) {
      shortScore = -0.6;
      shortNote = `resistance ${resistance.toPrecision(8)} broken (bullish -0.60)`;
    } else if (Math.abs(closeLast - resistance) <= cfg.zoneAtrMult * atrLast) {
      let best = 0;
      for (let age = 0; age < decays.length; age++) {
        const bar = ltf[ltf.length - 1 - age];
        const rng = bar.high - bar.low;
        if (rng <= 0) continue;
        const upperRatio = (bar.high - Math.max(bar.open, bar.close)) / rng;
        const touched = bar.high >= resistance - 0.15 * atrLast;
        const reclaimed = bar.close < resistance;
        if (touched && reclaimed && upperRatio >= cfg.wickMinRatio) {
          best = Math.max(best, clip(upperRatio, 0, 1) * decays[age]);
        }
      }
      if (best > 0) {
        shortScore = best;
        shortNote = `bearish wick rejection at resistance ${resistance.toPrecision(8)}`;
      }
    }
  }

  const comp = clip(longScore - shortScore);
  return { comp, reason: `zone=${p2(comp)} (${longNote || shortNote || "no qualifying zone interaction"})` };
}
function momentumComponent(ltf: Candle[], cfg: ConfluenceConfig, atrLast: number): { comp: number; reason: string } {
  const r = rsi(ltf, cfg.rsiPeriod);
  const rv = r[r.length - 1];
  if (rv === null || !isFinite(rv)) return { comp: 0, reason: "momentum=+0.00 (rsi unavailable)" };
  const rsiComp = clip((rv - 50) / 20);
  const emaSeries = ema(closes(ltf), cfg.momEma);
  const emaLast = emaSeries[emaSeries.length - 1];
  const emaPrev = emaSeries[emaSeries.length - 4];
  const slope = emaLast !== null && emaLast !== undefined && emaPrev !== null && emaPrev !== undefined
    ? (emaLast - emaPrev) / atrLast
    : 0;
  const slopeComp = clip(slope);
  const comp = clip(0.6 * rsiComp + 0.4 * slopeComp);
  return {
    comp,
    reason: `momentum=${p2(comp)} (rsi=${rv.toFixed(1)}, ema${cfg.momEma} slope=${p2(slope)}atr/3bars)`,
  };
}

function volumeComponent(ltf: Candle[], momentum: number): { comp: number; reason: string } {
  if (ltf.length < 21) return { comp: 0, reason: "volume=+0.00 (unavailable)" };
  const vols = ltf.map((c) => (isFinite(c.volume) ? c.volume : 0));
  let baseline = 0;
  for (let i = ltf.length - 21; i < ltf.length - 1; i++) baseline += vols[i];
  baseline /= 20;
  const last = vols[ltf.length - 1];
  if (baseline <= 0) return { comp: 0, reason: "volume=+0.00 (zero baseline)" };
  const ratio = last / baseline;
  const comp = clip(Math.max(0, ratio - 1), 0, 1) * sgn(momentum);
  return { comp, reason: `volume=${p2(comp)} (last bar ${ratio.toFixed(2)}x 20-bar avg)` };
}

export function analyzeConfluence(
  ltf: Candle[], htf: Candle[], cfg: ConfluenceConfig = DEFAULT_CONFIG
): ConfluenceResult {
  if (!ltf || !htf || ltf.length < MIN_BARS || htf.length < MIN_BARS) {
    return neutral(
      `insufficient data (ltf=${ltf ? ltf.length : 0}, htf=${htf ? htf.length : 0}, need ${MIN_BARS})`
    );
  }

  const trend = trendComponent(htf, cfg);
  const latr = atr(ltf);
  const atrLast = latr[latr.length - 1];
  if (atrLast === null || atrLast <= 0) return neutral("ltf ATR unavailable");

  const zone = zoneComponent(ltf, cfg, atrLast);
  const mom = momentumComponent(ltf, cfg, atrLast);
  const vol = volumeComponent(ltf, mom.comp);

  const totalW = cfg.weightTrend + cfg.weightZone + cfg.weightMomentum + cfg.weightVolume;
  const net = totalW
    ? (cfg.weightTrend * trend.comp + cfg.weightZone * zone.comp +
       cfg.weightMomentum * mom.comp + cfg.weightVolume * vol.comp) / totalW
    : 0;

  const score = Math.round(50 * (1 + net) * 10) / 10;
  const direction =
    net >= cfg.directionThreshold ? "LONG" : net <= -cfg.directionThreshold ? "SHORT" : "NEUTRAL";

  return {
    score,
    direction,
    components: { trend: trend.comp, zone: zone.comp, momentum: mom.comp, volume: vol.comp },
    reasons: [trend.reason, zone.reason, mom.reason, vol.reason],
    atr: atrLast,
    htfSupport: null,
    htfResistance: null,
  };
}

/** Python gate_signal(): side-relative quality with opposite-direction veto. */
export function gateSignal(
  report: ConfluenceResult,
  side: "long" | "short" | "LONG" | "SHORT",
  cfg: ConfluenceConfig = DEFAULT_CONFIG
): { passed: boolean; reason: string } {
  const up = String(side).toUpperCase();
  const wanted = up === "LONG" || up === "BUY" || up === "B" ? "LONG" : "SHORT";
  if (cfg.vetoOpposite && report.direction !== "NEUTRAL" && report.direction !== wanted) {
    return {
      passed: false,
      reason: `CONFLUENCE_VETO: score ${report.score.toFixed(0)} points ${report.direction}, signal is ${wanted}`,
    };
  }
  const sideScore = wanted === "LONG" ? report.score : 100 - report.score;
  if (sideScore < cfg.minScore) {
    return {
      passed: false,
      reason: `LOW_CONFLUENCE: side score ${sideScore.toFixed(0)} < minimum ${cfg.minScore.toFixed(0)}`,
    };
  }
  return { passed: true, reason: `confluence ok (${sideScore.toFixed(0)} >= ${cfg.minScore.toFixed(0)})` };
}