import { dispatchNotice } from "@/lib/notifications/service";
import { getRepo } from "@/lib/repo";
import { flags } from "@/lib/flags";
import { getCandles } from "@/lib/market/service";
import { getSettings, logAudit } from "@/lib/settings";
import { ALL_STRATEGIES, buildAnalysis } from "@/lib/strategy/engine";
import { TF_MINUTES, TIMEFRAMES, type Timeframe } from "@/lib/types";
import { analyzeConfluence, gateSignal, type ConfluenceResult } from "@/lib/strategy/quant/confluence";
import { buildFeatures, toArray, FEATURE_COLUMNS } from "@/lib/strategy/quant/features";
import { predictProba, gateWithMeta, META_MODEL as META_WEIGHTS } from "@/lib/strategy/quant/metaModel";
import { regime } from "@/lib/strategy/quant/diagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOUR = 3600 * 1000;

/** Higher-timeframe mapping for multi-timeframe confluence (Python bot: 15m->1h). */
const HTF_MAP: Partial<Record<Timeframe, Timeframe>> = {
  "1m": "5m", "3m": "15m", "5m": "15m", "15m": "1H", "30m": "2H",
  "1H": "4H", "2H": "4H", "4H": "1D", "1D": "1W",
};

interface QuantConfluence {
  score: number; direction: "LONG" | "SHORT" | "NEUTRAL";
  components: { trend: number; zone: number; momentum: number; volume: number };
  reasons: string[]; atr: number | null;
}
interface QuantPayload {
  confluence: QuantConfluence;
  htfSource: string;
  regime: "trend" | "range";
  metaProba: number | null;
  metaGate: { passed: boolean; reason: string };
  features: number[] | null;
  featureColumns: string[] | null;
}

export async function GET(req: Request) {
  if (!flags.strategyEngine()) {
    return Response.json({ error: "Strategy engine disabled", analysis: null, enabled: false });
  }
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "BTCUSD").toUpperCase();
  const tf = url.searchParams.get("timeframe") || "15m";
  if (!TIMEFRAMES.includes(tf as Timeframe)) {
    return Response.json({ error: `Unsupported timeframe: ${tf}` }, { status: 400 });
  }

  const settings = await getSettings();
  const candleRes = await getCandles(
    symbol,
    tf as Timeframe,
    Math.max(settings.srLookback + 80, 260)
  );

  candleRes.candles = candleRes.candles.filter(c => (c.time + TF_MINUTES[tf as Timeframe] * 60) * 1000 <= Date.now());
  const analysis = buildAnalysis(
    symbol,
    tf as Timeframe,
    candleRes.candles,
    {
      sensitivity: settings.srSensitivity,
      minTouches: settings.srMinTouches,
      lookback: settings.srLookback,
    },
    settings.strategiesEnabled,
    ALL_STRATEGIES
  );

  // ---- quant confluence + meta gate (port of trader_bot_v2) --------------
  let quant: QuantPayload | null = null;
  try {
    const htfTf = HTF_MAP[tf as Timeframe];
    let htfCandles = candleRes.candles;
    let htfSource = "ltf-proxy";
    if (htfTf) {
      try {
        const want = Math.max(60, Math.min(300, Math.round(
          (candleRes.candles.length * TF_MINUTES[tf as Timeframe]) / TF_MINUTES[htfTf]) + 40));
        const hres = await getCandles(symbol, htfTf, Math.max(settings.srLookback + 80, want));
        hres.candles = hres.candles.filter(c => (c.time + TF_MINUTES[htfTf] * 60) * 1000 <= Date.now());
        if (hres.candles.length >= 40) { htfCandles = hres.candles; htfSource = htfTf; }
      } catch { /* keep ltf proxy */ }
    }
    const conf = analyzeConfluence(candleRes.candles, htfCandles);
    const feats = buildFeatures(candleRes.candles);
    const minProb = Number(process.env.META_MODEL_MIN_PROB ?? 0.5);
    const proba = feats ? predictProba(META_WEIGHTS, feats) : null;
    quant = {
      confluence: {
        score: conf.score, direction: conf.direction,
        components: conf.components, reasons: conf.reasons, atr: conf.atr,
      },
      htfSource,
      regime: regime(candleRes.candles),
      metaProba: proba,
      metaGate: proba !== null
        ? gateWithMeta(proba, Number.isFinite(minProb) ? minProb : 0.5)
        : { passed: true, reason: "meta model absent (features unavailable)" },
      features: feats ? toArray(feats) : null,
      featureColumns: [...FEATURE_COLUMNS],
    };
  } catch {
    quant = null;
  }

  // ---- persist signals ----------------------------------------------------
  const repo = await getRepo();
  const cutoff = new Date(Date.now() - 24 * HOUR).toISOString();
  // A signal stays ACTIVE until it is superseded, invalidated or older than 24h.
  for (const row of await repo.listActiveSignals(symbol)) {
    if (row.createdAt < cutoff) {
      await repo.updateSignal(row.id, { outcome: "EXPIRED" });
    }
  }

  for (const s of analysis.signals) {
    // Quant veto: confluence direction/score + meta-model probability gate.
    if (quant && (s.status === "LONG_SETUP" || s.status === "SHORT_SETUP")) {
      const side = s.status === "LONG_SETUP" ? "LONG" : "SHORT";
      const cg = gateSignal(
        { ...quant.confluence, htfSupport: null, htfResistance: null } as ConfluenceResult,
        side
      );
      if (!cg.passed || !quant.metaGate.passed) {
        s.status = "WATCH";
        s.reasons = [...s.reasons, cg.passed ? quant.metaGate.reason : cg.reason];
      } else {
        s.reasons = [...s.reasons, cg.reason, quant.metaGate.reason];
      }
    }
    const prev = await repo.findActiveSignal(symbol, tf, s.strategy);

    const changed =
      !prev ||
      prev.status !== s.status ||
      Math.abs((prev.entry ?? 0) - (s.entry ?? 0)) > (s.entry ?? 0) * 0.0005;

    if (!changed && prev) {
      await repo.updateSignal(prev.id, {
        price: s.price, entry: s.entry, stop: s.stop, target: s.target,
        rr: s.rr, reasons: s.reasons,
      });
      s.id = prev.id;
    } else {
      if (prev) {
        await repo.updateSignal(prev.id, { outcome: "SUPERSEDED" });
      }
      if (s.status !== "WAIT") {
        const row = await repo.insertSignal({
          symbol, timeframe: tf as Timeframe, strategy: s.strategy, status: s.status,
          price: s.price, entry: s.entry, stop: s.stop, target: s.target,
          rr: s.rr, reasons: s.reasons, outcome: "ACTIVE",
        });
        s.id = row.id;
        if (s.status === "LONG_SETUP" || s.status === "SHORT_SETUP") {
          await logAudit("signal_created", {
            symbol, timeframe: tf, strategy: s.strategy, status: s.status,
          });
        }
      }
    }
  }

  for (const signal of analysis.signals) {
    if (signal.status !== "LONG_SETUP" && signal.status !== "SHORT_SETUP") continue;
    await dispatchNotice({ symbol, timeframe: tf, chart: "normal", strategy: signal.strategy,
      direction: signal.status === "LONG_SETUP" ? "LONG" : "SHORT", barTime: signal.ts,
      source: candleRes.source, entry: signal.entry, stop: signal.stop, target: signal.target, reasons: signal.reasons });
  }
  return Response.json({ analysis, quant, source: candleRes.source, enabled: flags.strategyEngine() });
}
