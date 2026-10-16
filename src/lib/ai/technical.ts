/** Versioned, causal OHLCV rules. Shapes are hypotheses, never forecasts. */
import type { Candle } from "../types";

export const TECHNICAL_VERSION = "technical-v1";
export interface PatternMatch {
  name: string;
  bias: "bullish" | "bearish" | "neutral";
  reason: string;
}
export interface StrategyCheck {
  name: string;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  checks: { rule: string; passed: boolean | null }[];
}
export interface TechnicalEvidence {
  version: string;
  basis: "raw closed candles";
  patterns: PatternMatch[];
  recentCandles: Candle[];
  indicators: {
    ema: Record<number, number | null>;
    rsi14: number | null;
    adx14: number | null;
    vwap: number | null;
    vwapAnchor: string;
    macd: { line: number; signal: number; histogram: number } | null;
    bollinger: { middle: number; upper: number; lower: number } | null;
  };
  strategies: StrategyCheck[];
  cautions: string[];
}
const body = (c: Candle) => Math.abs(c.close - c.open);
const range = (c: Candle) => c.high - c.low;
const bull = (c: Candle) => c.close > c.open;
const bear = (c: Candle) => c.close < c.open;
const top = (c: Candle) => Math.max(c.open, c.close);
const bottom = (c: Candle) => Math.min(c.open, c.close);
const doji = (c: Candle) => range(c) > 0 && body(c) <= range(c) * 0.1;
const long = (c: Candle) => range(c) > 0 && body(c) >= range(c) * 0.6;
const inside = (small: Candle, big: Candle) =>
  top(small) < top(big) && bottom(small) > bottom(big);
const engulfs = (a: Candle, b: Candle) =>
  bottom(a) <= bottom(b) && top(a) >= top(b) && body(a) > body(b) && !doji(b);

/** Inspect only the terminal pattern, with trend measured BEFORE its first bar. */
export function detectPatterns(candles: Candle[]): PatternMatch[] {
  const out: PatternMatch[] = [];
  if (candles.length < 8) return out;
  const c = candles.at(-1)!,
    b = candles.at(-2)!,
    a = candles.at(-3)!;
  function trend(size: number): number {
    const end = candles.length - size;
    const prior = candles.slice(Math.max(0, end - 5), end);
    if (prior.length < 5) return 0;
    const delta = prior.at(-1)!.close - prior[0].close;
    const scale = prior.reduce((sum, x) => sum + range(x), 0) / prior.length;
    return Math.abs(delta) > scale * 0.5 ? Math.sign(delta) : 0;
  }
  function add(
    name: string,
    bias: PatternMatch["bias"],
    condition: boolean,
    size: number,
    reason: string,
    continuation = false,
  ) {
    const expected =
      bias === "bullish" ? (continuation ? 1 : -1) : continuation ? -1 : 1;
    if (condition && (bias === "neutral" || trend(size) === expected))
      out.push({ name, bias, reason });
  }
  const lower = bottom(c) - c.low,
    upper = c.high - top(c);
  add(
    "Doji",
    "neutral",
    doji(c),
    1,
    "Body is at most 10% of range; indecision, not a directional call.",
  );
  add(
    "Spinning Top",
    "neutral",
    !doji(c) && body(c) <= range(c) * 0.3 && lower > body(c) && upper > body(c),
    1,
    "Small body with two substantial shadows.",
  );
  const hammer =
    body(c) > range(c) * 0.1 && lower >= 2 * body(c) && upper <= body(c) * 0.5;
  const inverted =
    body(c) > range(c) * 0.1 && upper >= 2 * body(c) && lower <= body(c) * 0.5;
  add(
    "Hammer",
    "bullish",
    hammer,
    1,
    "Long lower shadow after a decline; needs later confirmation.",
  );
  add(
    "Hanging Man",
    "bearish",
    hammer,
    1,
    "Long lower shadow after an advance; needs later confirmation.",
  );
  add(
    "Inverted Hammer",
    "bullish",
    inverted,
    1,
    "Long upper shadow after a decline.",
  );
  add(
    "Shooting Star",
    "bearish",
    inverted,
    1,
    "Long upper shadow after an advance.",
  );
  add(
    "Dragonfly Doji",
    "bullish",
    doji(c) && lower >= range(c) * 0.6 && upper <= range(c) * 0.1,
    1,
    "Doji with lower rejection after a decline; support not independently established.",
  );
  add(
    "Gravestone Doji",
    "bearish",
    doji(c) && upper >= range(c) * 0.6 && lower <= range(c) * 0.1,
    1,
    "Doji with upper rejection after an advance.",
  );
  add(
    "Bullish Marubozu",
    "bullish",
    bull(c) && body(c) >= range(c) * 0.9 && range(c) > 0,
    1,
    "At least 90% body in an existing advance.",
    true,
  );
  add(
    "Bearish Marubozu",
    "bearish",
    bear(c) && body(c) >= range(c) * 0.9 && range(c) > 0,
    1,
    "At least 90% body in an existing decline.",
    true,
  );
  const upEngulf = bear(b) && bull(c) && engulfs(c, b);
  const downEngulf = bull(b) && bear(c) && engulfs(c, b);
  const upHarami = bear(b) && bull(c) && long(b) && inside(c, b) && !doji(c);
  const downHarami = bull(b) && bear(c) && long(b) && inside(c, b) && !doji(c);
  add(
    "Bullish Engulfing",
    "bullish",
    upEngulf,
    2,
    "Green body fully covers prior red body after a decline.",
  );
  add(
    "Bearish Engulfing",
    "bearish",
    downEngulf,
    2,
    "Red body fully covers prior green body after an advance.",
  );
  add(
    "Bullish Harami",
    "bullish",
    upHarami,
    2,
    "Small green body strictly inside a large red body.",
  );
  add(
    "Bearish Harami",
    "bearish",
    downHarami,
    2,
    "Small red body strictly inside a large green body.",
  );
  // Strict gap definitions: deliberately uncommon on continuously traded crypto.
  add(
    "Piercing Line",
    "bullish",
    bear(b) &&
      long(b) &&
      bull(c) &&
      c.open < b.low &&
      c.close > (b.open + b.close) / 2 &&
      c.close < b.open,
    2,
    "Gap below prior low, then closes above prior body midpoint.",
  );
  add(
    "Dark Cloud Cover",
    "bearish",
    bull(b) &&
      long(b) &&
      bear(c) &&
      c.open > b.high &&
      c.close < (b.open + b.close) / 2 &&
      c.close > b.open,
    2,
    "Gap above prior high, then closes below prior body midpoint.",
  );
  const tolerance = ((range(b) + range(c)) / 2) * 0.05;
  add(
    "Tweezer Bottom",
    "bullish",
    tolerance > 0 && bear(b) && bull(c) && Math.abs(b.low - c.low) <= tolerance,
    2,
    "Two lows within 5% of average candle range after a decline.",
  );
  add(
    "Tweezer Top",
    "bearish",
    tolerance > 0 &&
      bull(b) &&
      bear(c) &&
      Math.abs(b.high - c.high) <= tolerance,
    2,
    "Two highs within 5% of average candle range after an advance.",
  );
  add(
    "Morning Star",
    "bullish",
    bear(a) &&
      long(a) &&
      body(b) <= body(a) * 0.3 &&
      top(b) < bottom(a) &&
      bull(c) &&
      c.close > (a.open + a.close) / 2,
    3,
    "Large red, gapped small body, green recovery beyond first midpoint.",
  );
  add(
    "Evening Star",
    "bearish",
    bull(a) &&
      long(a) &&
      body(b) <= body(a) * 0.3 &&
      bottom(b) > top(a) &&
      bear(c) &&
      c.close < (a.open + a.close) / 2,
    3,
    "Large green, gapped small body, red decline below first midpoint.",
  );
  add(
    "Three White Soldiers",
    "bullish",
    [a, b, c].every(
      (x) => bull(x) && long(x) && x.high - x.close <= range(x) * 0.2,
    ) &&
      b.close > a.close &&
      c.close > b.close &&
      b.open > a.open &&
      b.open < a.close &&
      c.open > b.open &&
      c.open < b.close,
    3,
    "Three strong rising green bodies opening within prior bodies.",
  );
  add(
    "Three Black Crows",
    "bearish",
    [a, b, c].every(
      (x) => bear(x) && long(x) && x.close - x.low <= range(x) * 0.2,
    ) &&
      b.close < a.close &&
      c.close < b.close &&
      b.open < a.open &&
      b.open > a.close &&
      c.open < b.open &&
      c.open > b.close,
    3,
    "Three strong falling red bodies opening within prior bodies.",
  );
  add(
    "Three Inside Up",
    "bullish",
    bear(a) &&
      long(a) &&
      bull(b) &&
      inside(b, a) &&
      bull(c) &&
      c.close > a.open,
    3,
    "Bullish harami followed by close above first open.",
  );
  add(
    "Three Inside Down",
    "bearish",
    bull(a) &&
      long(a) &&
      bear(b) &&
      inside(b, a) &&
      bear(c) &&
      c.close < a.open,
    3,
    "Bearish harami followed by close below first open.",
  );
  add(
    "Three Outside Up",
    "bullish",
    bear(a) && bull(b) && engulfs(b, a) && bull(c) && c.close > b.close,
    3,
    "Bullish engulfing followed by higher close.",
  );
  add(
    "Three Outside Down",
    "bearish",
    bull(a) && bear(b) && engulfs(b, a) && bear(c) && c.close < b.close,
    3,
    "Bearish engulfing followed by lower close.",
  );
  add(
    "Three Star Bullish",
    "bullish",
    [a, b, c].every(doji) && top(b) < bottom(a) && top(b) < bottom(c),
    3,
    "Three doji with the middle body gapped below both neighbours.",
  );
  add(
    "Three Star Bearish",
    "bearish",
    [a, b, c].every(doji) && bottom(b) > top(a) && bottom(b) > top(c),
    3,
    "Three doji with the middle body gapped above both neighbours.",
  );
  if (candles.length >= 10) {
    const five = candles.slice(-5),
      first = five[0],
      last = five[4],
      mid = five.slice(1, 4);
    const contained = mid.every(
      (x) =>
        x.high < first.high && x.low > first.low && body(x) < body(first) * 0.5,
    );
    add(
      "Rising Three Methods",
      "bullish",
      bull(first) &&
        long(first) &&
        contained &&
        mid.every(bear) &&
        bull(last) &&
        long(last) &&
        last.close > first.high,
      5,
      "Three small contained pullback bars then an upside close breakout.",
      true,
    );
    add(
      "Falling Three Methods",
      "bearish",
      bear(first) &&
        long(first) &&
        contained &&
        mid.every(bull) &&
        bear(last) &&
        long(last) &&
        last.close < first.low,
      5,
      "Three small contained rebound bars then a downside close breakout.",
      true,
    );
  }
  return out;
}

/** SMA-seeded exponential moving average; missing warmup stays null. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length < period) return out;
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = value;
  for (let i = period; i < values.length; i++) {
    value += (2 / (period + 1)) * (values[i] - value);
    out[i] = value;
  }
  return out;
}
function rsi(values: number[], n = 14): number | null {
  if (values.length <= n) return null;
  let gain = 0,
    loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    gain += Math.max(d, 0) / n;
    loss += Math.max(-d, 0) / n;
  }
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  return gain === 0 && loss === 0
    ? 50
    : loss === 0
      ? 100
      : 100 - 100 / (1 + gain / loss);
}
function adx(c: Candle[], n = 14): (number | null)[] {
  const out: (number | null)[] = c.map(() => null);
  let tr = 0,
    plus = 0,
    minus = 0;
  const dx: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high,
      down = c[i - 1].low - c[i].low;
    const t = Math.max(
      range(c[i]),
      Math.abs(c[i].high - c[i - 1].close),
      Math.abs(c[i].low - c[i - 1].close),
    );
    const p = up > down && up > 0 ? up : 0,
      m = down > up && down > 0 ? down : 0;
    if (i <= n) {
      tr += t;
      plus += p;
      minus += m;
    } else {
      tr = tr - tr / n + t;
      plus = plus - plus / n + p;
      minus = minus - minus / n + m;
    }
    if (i >= n) {
      const sum = plus + minus;
      dx.push(tr === 0 || sum === 0 ? 0 : (100 * Math.abs(plus - minus)) / sum);
      if (dx.length === n) out[i] = dx.reduce((a, b) => a + b, 0) / n;
      else if (dx.length > n) out[i] = (out[i - 1]! * (n - 1) + dx.at(-1)!) / n;
    }
  }
  return out;
}

export function analyseTechnical(candles: Candle[]): TechnicalEvidence {
  if (
    !candles.length ||
    candles.some(
      (c, i) =>
        ![c.time, c.open, c.high, c.low, c.close, c.volume].every(
          Number.isFinite,
        ) ||
        c.volume < 0 ||
        c.low > bottom(c) ||
        c.high < top(c) ||
        c.low > c.high ||
        (i > 0 && c.time <= candles[i - 1].time),
    )
  )
    throw new Error(
      "Technical analysis requires valid, strictly ordered OHLCV candles",
    );
  const closes = candles.map((c) => c.close),
    last = candles.at(-1)!;
  const averages: Record<number, number | null> = {};
  const series: Record<number, (number | null)[]> = {};
  for (const p of [9, 12, 21, 26, 50, 200]) {
    series[p] = ema(closes, p);
    averages[p] = series[p].at(-1) ?? null;
  }
  const a = adx(candles),
    vwapSeries: (number | null)[] = [];
  let day = -1,
    pv = 0,
    vol = 0,
    completeSession = false;
  const step = candles.length > 1 ? candles[1].time - candles[0].time : 300;
  candles.forEach((c, i) => {
    const d = Math.floor(c.time / 86400);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
      completeSession = c.time % 86400 === 0;
    }
    if (
      i > 0 &&
      d === Math.floor(candles[i - 1].time / 86400) &&
      c.time - candles[i - 1].time !== step
    )
      completeSession = false;
    pv += ((c.high + c.low + c.close) / 3) * c.volume;
    vol += c.volume;
    vwapSeries[i] = vol > 0 && completeSession ? pv / vol : null;
  });
  const vwap = vwapSeries.at(-1) ?? null;
  const macdValues = closes
    .slice(25)
    .map((_, i) =>
      series[12][i + 25] !== null && series[26][i + 25] !== null
        ? series[12][i + 25]! - series[26][i + 25]!
        : NaN,
    );
  const signal = macdValues.every(Number.isFinite)
    ? ema(macdValues, 9).at(-1)
    : null;
  const line = macdValues.at(-1);
  const tail = closes.slice(-20),
    middle = tail.reduce((a, b) => a + b, 0) / tail.length;
  const sd = Math.sqrt(
    tail.reduce((s, v) => s + (v - middle) ** 2, 0) / tail.length,
  );
  const rsi14 = rsi(closes),
    adx14 = a.at(-1) ?? null;
  const missing = (...x: (number | null)[]) => x.some((v) => v === null);
  const check = (rule: string, available: boolean, passed: boolean) => ({
    rule,
    passed: available ? passed : null,
  });
  const strategies: StrategyCheck[] = [];
  // Explicit causal interpretation of the poster: cross on the previous closed
  // confirmation bar; breakout confirmed by this bar's CLOSE, never a guessed fill.
  for (const side of [1, -1]) {
    const i = candles.length - 2,
      confirmation = candles[i],
      before = i - 1;
    const e9 = series[9][i] ?? null,
      e21 = series[21][i] ?? null,
      prev9 = series[9][before] ?? null,
      prev21 = series[21][before] ?? null;
    const checks = [
      check(
        "Exponential Moving Average 9 crosses 21 on prior confirmation bar",
        !missing(e9, e21, prev9, prev21),
        !missing(e9, e21, prev9, prev21) &&
          side * (e9! - e21!) > 0 &&
          side * (prev9! - prev21!) <= 0,
      ),
      check(
        "Confirmation close on trend side of EMA 9 and UTC-session Volume Weighted Average Price",
        !!confirmation && !missing(e9, vwapSeries[i] ?? null),
        !!confirmation &&
          !missing(e9, vwapSeries[i] ?? null) &&
          side * (confirmation.close - e9!) > 0 &&
          side * (confirmation.close - vwapSeries[i]!) > 0,
      ),
      check(
        "Average Directional Index 14 above 20 on confirmation bar",
        a[i] != null,
        (a[i] ?? 0) > 20,
      ),
      check(
        "Next closed candle closes beyond confirmation high/low",
        !!confirmation,
        !!confirmation &&
          (side > 0
            ? last.close > confirmation.high
            : last.close < confirmation.low),
      ),
    ];
    strategies.push({
      name: `EMA 9/21 + VWAP + ADX · ${side > 0 ? "long" : "short"}`,
      direction: checks.every((c) => c.passed === true)
        ? side > 0
          ? "LONG"
          : "SHORT"
        : "NEUTRAL",
      checks,
    });
  }
  for (const side of [1, -1]) {
    const checks = [
      check(
        "Close on trend side of UTC-session Volume Weighted Average Price",
        vwap !== null,
        vwap !== null && side * (last.close - vwap) > 0,
      ),
      check(
        "Close on trend side of Exponential Moving Average 21 (explicit chosen period)",
        averages[21] !== null,
        averages[21] !== null && side * (last.close - averages[21]!) > 0,
      ),
      check(
        "Relative Strength Index 14 above/below 50",
        rsi14 !== null,
        rsi14 !== null && side * (rsi14 - 50) > 0,
      ),
    ];
    strategies.push({
      name: `VWAP + RSI + EMA 21 · ${side > 0 ? "long" : "short"}`,
      direction: checks.every((c) => c.passed === true)
        ? side > 0
          ? "LONG"
          : "SHORT"
        : "NEUTRAL",
      checks,
    });
  }
  return {
    version: TECHNICAL_VERSION,
    basis: "raw closed candles",
    recentCandles: candles.slice(-5).map((c) => ({ ...c })),
    patterns: detectPatterns(candles),
    indicators: {
      ema: averages,
      rsi14,
      adx14,
      vwap,
      vwapAnchor: "00:00 UTC daily; requires history from session start",
      macd:
        signal != null && line !== undefined && Number.isFinite(line)
          ? { line, signal, histogram: line - signal }
          : null,
      bollinger:
        tail.length === 20
          ? { middle, upper: middle + 2 * sd, lower: middle - 2 * sd }
          : null,
    },
    strategies,
    cautions: [
      "Shape match is not proof of reversal; trend context is required.",
      "EMA, MACD and price filters are correlated, not independent votes.",
      "No validated win-rate claim; costs, funding and slippage excluded.",
      "Indian equity-session time tips do not define crypto market hours.",
      ...(vwap === null
        ? [
            "VWAP unavailable: missing UTC session start or positive session volume.",
          ]
        : []),
    ],
  };
}
