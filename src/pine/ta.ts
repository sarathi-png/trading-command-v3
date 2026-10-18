/**
 * Pine `ta.*` namespace — the streaming indicator library.
 *
 * Pine indicators are *stateful*: `ta.sma(close, 20)` is not a pure function of
 * the current bar, it is a function of the whole series. This module therefore
 * implements every indicator as a small state machine that is advanced once
 * per bar, with the state kept per CALL SITE (the parser assigns a stable id
 * to every call expression) — exactly like Pine, where two calls with
 * different series produce two different instances.
 *
 * `na` handling follows Pine: a value that is not yet computable is `na`, and
 * `na` inside a window poisons the result of that bar.
 */
import { type PineValue, toNumber, truthy } from "./values";

export interface BarData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface StreamContext {
  /** Stable per-call-site id (from the parser). */
  site: number;
  /** Index of the bar being evaluated. */
  barIndex: number;
  lastBarIndex: number;
  /** Current bar. */
  bar: BarData;
  /** Previous bar close (undefined on the first bar). */
  prevClose: number | undefined;
  /** All bars up to and including the current one. */
  bars: BarData[];
  /** Per-call-site state bucket, created on demand. */
  state: <T>(name: string, create: () => T) => T;
}

export type TaFunction = (
  args: PineValue[],
  ctx: StreamContext,
  named: Map<string, PineValue>
) => PineValue;

const NA = null;

function num(value: PineValue): number | null {
  return toNumber(value);
}

function len(value: PineValue, fallback: number): number {
  const parsed = toNumber(value);
  if (parsed === null) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function arg(
  args: PineValue[],
  named: Map<string, PineValue>,
  index: number,
  name: string,
  fallback: PineValue
): PineValue {
  const namedValue = named.get(name);
  if (namedValue !== undefined) return namedValue;
  if (index < args.length) return args[index];
  return fallback;
}

/** Rolling window of values, newest last. NaN marks an `na` sample. */
interface Window {
  values: number[];
  push(value: number | null): void;
  tail(count: number): number[];
}

function createWindow(): Window {
  return {
    values: [],
    push(value) {
      this.values.push(value === null || !Number.isFinite(value) ? NaN : value);
      if (this.values.length > 2000) this.values.splice(0, this.values.length - 2000);
    },
    tail(count) {
      if (count <= 0) return [];
      return this.values.slice(Math.max(0, this.values.length - count));
    },
  };
}

function windowAverage(window: Window, count: number): number | null {
  if (window.values.length < count) return null;
  const values = window.tail(count);
  let sum = 0;
  for (const value of values) {
    if (Number.isNaN(value)) return null;
    sum += value;
  }
  return sum / count;
}

/* ------------------------------------------------------------------ */
/* Moving averages                                                     */
/* ------------------------------------------------------------------ */

const sma: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("sma", () => ({ window: createWindow() }));
  state.window.push(source);
  return windowAverage(state.window, length);
};

const ema: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("ema", () => ({ prev: null as number | null }));
  const alpha = 2 / (length + 1);
  state.prev = state.prev === null
    ? source
    : (source as number) * alpha + state.prev * (1 - alpha);
  return state.prev;
};

const rma: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("rma", () => ({ sum: 0, count: 0, prev: null as number | null }));
  if (source === null) {
    state.count = 0;
    state.sum = 0;
    state.prev = null;
    return null;
  }
  if (state.prev === null) {
    state.sum += source;
    state.count += 1;
    if (state.count < length) return null;
    state.prev = state.sum / length;
    return state.prev;
  }
  state.prev = (state.prev * (length - 1) + source) / length;
  return state.prev;
};

const wma: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("wma", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) return null;
    sum += values[i] * (i + 1);
    weight += i + 1;
  }
  return sum / weight;
};

const vwma: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("vwma", () => ({ window: createWindow(), volumes: createWindow() }));
  state.window.push(source);
  state.volumes.push(ctx.bar.volume);
  const values = state.window.tail(length);
  const volumes = state.volumes.tail(length);
  if (values.length < length) return null;
  let numSum = 0;
  let denSum = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i]) || Number.isNaN(volumes[i])) return null;
    numSum += values[i] * volumes[i];
    denSum += volumes[i];
  }
  return denSum === 0 ? null : numSum / denSum;
};

const hma: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("hma", () => ({ half: null as number | null, full: null as number | null, raw: null as number | null }));
  const halfLength = Math.max(1, Math.floor(length / 2));
  const sqrtLength = Math.max(1, Math.floor(Math.sqrt(length)));
  const alpha = 2 / (halfLength + 1);
  const alphaFull = 2 / (length + 1);
  const alphaRaw = 2 / (sqrtLength + 1);
  if (source === null) return null;
  state.half = state.half === null ? source : source * alpha + state.half * (1 - alpha);
  state.full = state.full === null ? source : source * alphaFull + state.full * (1 - alphaFull);
  const raw = 2 * state.half - state.full;
  state.raw = state.raw === null ? raw : raw * alphaRaw + state.raw * (1 - alphaRaw);
  return state.raw;
};

const swma: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const state = ctx.state("swma", () => ({ a: null as number | null, b: null as number | null, c: null as number | null, d: null as number | null }));
  const previous = state.d ?? source ?? 0;
  state.a = source;
  state.b = state.a;
  state.c = state.b;
  state.d = state.c;
  const value = ((state.a ?? 0) + (state.b ?? 0) * 2 + (state.c ?? 0) * 2 + (previous ?? 0) * 4) / 9;
  return value;
};

const alma: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const offset = num(arg(args, named, 2, "offset", 0.85)) ?? 0.85;
  const sigma = num(arg(args, named, 3, "sigma", 6)) ?? 6;
  const state = ctx.state("alma", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  const m = offset * (length - 1);
  const s = length / sigma;
  let norm = 0;
  let sum = 0;
  for (let i = 0; i < length; i++) {
    if (Number.isNaN(values[i])) return null;
    const weight = Math.exp(-((i - m) * (i - m)) / (2 * s * s));
    norm += weight;
    sum += values[i] * weight;
  }
  return norm === 0 ? null : sum / norm;
};

const dema: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("dema", () => ({ e1: null as number | null, e2: null as number | null, raw: null as number | null }));
  const alpha = 2 / (length + 1);
  if (source === null) return null;
  state.e1 = state.e1 === null ? source : source * alpha + state.e1 * (1 - alpha);
  state.e2 = state.e2 === null ? state.e1 : state.e1 * alpha + state.e2 * (1 - alpha);
  const raw = 2 * state.e1 - state.e2;
  state.raw = state.raw === null ? raw : raw * alpha + state.raw * (1 - alpha);
  return state.raw;
};

const tema: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("tema", () => ({
    e1: null as number | null, e2: null as number | null, e3: null as number | null,
    c1: null as number | null, c2: null as number | null, c3: null as number | null,
  }));
  const alpha = 2 / (length + 1);
  if (source === null) return null;
  state.e1 = state.e1 === null ? source : source * alpha + state.e1 * (1 - alpha);
  state.e2 = state.e2 === null ? state.e1 : state.e1 * alpha + state.e2 * (1 - alpha);
  state.e3 = state.e3 === null ? state.e2 : state.e2 * alpha + state.e3 * (1 - alpha);
  state.c1 = 2 * state.e1 - state.e2;
  state.c2 = 2 * state.e2 - state.e3;
  state.c3 = 2 * state.c1 - state.c2;
  return state.c3;
};

const linreg: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const offset = num(arg(args, named, 2, "offset", 0)) ?? 0;
  const state = ctx.state("linreg", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) return null;
    const x = i;
    const y = values[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const n = values.length;
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return [intercept + slope * (n - 1 + offset), slope];
};

/* ------------------------------------------------------------------ */
/* Volatility                                                          */
/* ------------------------------------------------------------------ */

const tr: TaFunction = (args, ctx, named) => {
  void args;
  void named;
  const { high, low } = ctx.bar;
  const prevClose = ctx.prevClose;
  if (prevClose === undefined) return high - low;
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
};

const atr: TaFunction = (args, ctx, named) => {
  const length = len(arg(args, named, 0, "length", 14), 14);
  const state = ctx.state("atr", () => ({ sum: 0, count: 0, prev: null as number | null, trs: createWindow() }));
  const trueRange = toNumber(tr([], ctx, new Map()));
  state.trs.push(trueRange);
  if (trueRange === null) {
    state.count = 0;
    state.sum = 0;
    state.prev = null;
    return null;
  }
  if (state.prev === null) {
    state.sum += trueRange;
    state.count += 1;
    if (state.count < length) return null;
    state.prev = state.sum / length;
    return state.prev;
  }
  state.prev = (state.prev * (length - 1) + trueRange) / length;
  return state.prev;
};

const stdev: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("stdev", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  let sum = 0;
  for (const value of values) {
    if (Number.isNaN(value)) return null;
    sum += value;
  }
  const mean = sum / length;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  variance /= length;
  return Math.sqrt(variance);
};

const variance: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("variance", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  let sum = 0;
  for (const value of values) {
    if (Number.isNaN(value)) return null;
    sum += value;
  }
  const mean = sum / length;
  let result = 0;
  for (const value of values) result += (value - mean) ** 2;
  return result / length;
};

const dev: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("dev", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  const mean = values.reduce((a, b) => a + b, 0) / length;
  let sum = 0;
  for (const value of values) sum += Math.abs(value - mean);
  return sum / length;
};

const median: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("median", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length).filter((v) => !Number.isNaN(v));
  if (values.length < length) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
};

const mode: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("mode", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  const counts = new Map<number, number>();
  for (const value of values) {
    if (Number.isNaN(value)) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
};

const percentrank: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("percentrank", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  const current = values[values.length - 1];
  if (Number.isNaN(current)) return null;
  let count = 0;
  for (let i = 0; i < values.length - 1; i++) {
    if (Number.isNaN(values[i])) continue;
    if (values[i] <= current) count++;
  }
  return (count / (values.length - 1)) * 100;
};

const percentileLinear: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const percentage = num(arg(args, named, 2, "percentage", 50)) ?? 50;
  const state = ctx.state("percentile", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length).filter((v) => !Number.isNaN(v));
  if (values.length < length) return null;
  values.sort((a, b) => a - b);
  const rank = (percentage / 100) * (values.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (rank - lower);
};

const percentileNearest: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const percentage = num(arg(args, named, 2, "percentage", 50)) ?? 50;
  const state = ctx.state("percentileNearest", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length).filter((v) => !Number.isNaN(v));
  if (values.length < length) return null;
  values.sort((a, b) => a - b);
  const index = Math.round((percentage / 100) * (values.length - 1));
  return values[Math.max(0, Math.min(values.length - 1, index))];
};

const correlation: TaFunction = (args, ctx, named) => {
  const source1 = num(arg(args, named, 0, "source1", NA));
  const source2 = num(arg(args, named, 1, "source2", NA));
  const length = len(arg(args, named, 2, "length", 14), 14);
  const state = ctx.state("correlation", () => ({ a: createWindow(), b: createWindow() }));
  state.a.push(source1);
  state.b.push(source2);
  const a = state.a.tail(length);
  const b = state.b.tail(length);
  if (a.length < length) return null;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < length; i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) return null;
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / length;
  const meanB = sumB / length;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < length; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
};

/* ------------------------------------------------------------------ */
/* Momentum / oscillators                                              */
/* ------------------------------------------------------------------ */

const rsi: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("rsi", () => ({ prev: null as number | null, gain: 0, loss: 0, count: 0, avgGain: null as number | null, avgLoss: null as number | null }));
  const prev = state.prev;
  state.prev = source;
  if (source === null || prev === null) return null;
  const change = source - prev;
  const gain = Math.max(change, 0);
  const loss = Math.max(-change, 0);
  if (state.avgGain === null) {
    state.gain += gain;
    state.loss += loss;
    state.count += 1;
    if (state.count < length) return null;
    state.avgGain = state.gain / length;
    state.avgLoss = state.loss / length;
  } else {
    const avgGain = state.avgGain ?? 0;
    const avgLoss = state.avgLoss ?? 0;
    state.avgGain = (avgGain * (length - 1) + gain) / length;
    state.avgLoss = (avgLoss * (length - 1) + loss) / length;
  }
  if (state.avgLoss === 0) return 100;
  const rs = state.avgGain / state.avgLoss;
  return 100 - 100 / (1 + rs);
};

const macd: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const fast = len(arg(args, named, 1, "fast_length", 12), 12);
  const slow = len(arg(args, named, 2, "slow_length", 26), 26);
  const signal = len(arg(args, named, 3, "signal_length", 9), 9);
  const state = ctx.state("macd", () => ({
    fastEma: null as number | null,
    slowEma: null as number | null,
    signalEma: null as number | null,
  }));
  const fastAlpha = 2 / (fast + 1);
  const slowAlpha = 2 / (slow + 1);
  const signalAlpha = 2 / (signal + 1);
  if (source === null) return [null, null, null];
  state.fastEma = state.fastEma === null ? source : source * fastAlpha + state.fastEma * (1 - fastAlpha);
  state.slowEma = state.slowEma === null ? source : source * slowAlpha + state.slowEma * (1 - slowAlpha);
  const macdLine = state.fastEma - state.slowEma;
  state.signalEma = state.signalEma === null
    ? macdLine
    : macdLine * signalAlpha + state.signalEma * (1 - signalAlpha);
  return [macdLine, state.signalEma, macdLine - state.signalEma];
};

const stoch: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const smoothK = len(arg(args, named, 2, "smoothK", 3), 3);
  const smoothD = len(arg(args, named, 3, "smoothD", 3), 3);
  const state = ctx.state("stoch", () => ({ raw: createWindow(), k: createWindow(), d: createWindow() }));
  const highest = Math.max(...ctx.bars.slice(-length).map((b) => b.high));
  const lowest = Math.min(...ctx.bars.slice(-length).map((b) => b.low));
  const range = highest - lowest;
  const raw = range === 0 ? null : ((source ?? 0) - lowest) * (100 / range);
  state.raw.push(raw);
  const k = windowAverage(state.raw, smoothK);
  state.k.push(k);
  const d = windowAverage(state.k, smoothD);
  state.d.push(d);
  return [k, d];
};

const cci: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("cci", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  const typical = ctx.bars.slice(-length).map((b) => (b.high + b.low + b.close) / 3);
  const mean = typical.reduce((a, b) => a + b, 0) / length;
  let deviation = 0;
  for (const value of typical) deviation += Math.abs(value - mean);
  deviation /= length;
  if (deviation === 0) return null;
  return (source! - mean) / (0.015 * deviation);
};

const mfi: TaFunction = (args, ctx, named) => {
  const length = len(arg(args, named, 0, "length", 14), 14);
  const state = ctx.state("mfi", () => ({
    positive: createWindow(),
    negative: createWindow(),
    prev: null as number | null,
  }));
  const typical = (ctx.bar.high + ctx.bar.low + ctx.bar.close) / 3;
  const prev = state.prev;
  state.prev = typical;
  if (prev === null) {
    state.positive.push(0);
    state.negative.push(0);
    return null;
  }
  const flow = typical * ctx.bar.volume;
  state.positive.push(typical > prev ? flow : 0);
  state.negative.push(typical < prev ? flow : 0);
  const positive = state.positive.tail(length);
  const negative = state.negative.tail(length);
  if (positive.length < length) return null;
  const positiveSum = positive.reduce((a, b) => a + b, 0);
  const negativeSum = negative.reduce((a, b) => a + b, 0);
  if (negativeSum === 0) return 100;
  return 100 - 100 / (1 + positiveSum / negativeSum);
};

const wpr: TaFunction = (args, ctx, named) => {
  const length = len(arg(args, named, 0, "length", 14), 14);
  const window = ctx.bars.slice(-length);
  if (window.length < length) return null;
  const highest = Math.max(...window.map((b) => b.high));
  const lowest = Math.min(...window.map((b) => b.low));
  const range = highest - lowest;
  if (range === 0) return null;
  return (highest - ctx.bar.close) * (100 / range);
};

const mom: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 10), 10);
  const state = ctx.state("mom", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length + 1);
  if (values.length < length + 1) return null;
  const current = values[values.length - 1];
  const previous = values[values.length - 1 - length];
  if (Number.isNaN(current) || Number.isNaN(previous)) return null;
  return current - previous;
};

const roc: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 9), 9);
  const state = ctx.state("roc", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length + 1);
  if (values.length < length + 1) return null;
  const current = values[values.length - 1];
  const previous = values[values.length - 1 - length];
  if (Number.isNaN(current) || Number.isNaN(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
};

const change: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 1), 1);
  const state = ctx.state("change", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length + 1);
  if (values.length < length + 1) return null;
  const current = values[values.length - 1];
  const previous = values[values.length - 1 - length];
  if (Number.isNaN(current) || Number.isNaN(previous)) return null;
  return current - previous;
};

const cum: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const state = ctx.state("cum", () => ({ total: 0 }));
  if (source === null) return null;
  state.total += source;
  return state.total;
};

const sum: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("sum", () => ({ window: createWindow() }));
  state.window.push(source);
  return windowAverage(state.window, length) === null
    ? null
    : state.window.tail(length).reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);
};

/* ------------------------------------------------------------------ */
/* Crosses and conditions                                              */
/* ------------------------------------------------------------------ */

function crossImpl(a: number | null, b: number | null, prevA: number | null, prevB: number | null, direction: "over" | "under"): boolean {
  if (a === null || b === null || prevA === null || prevB === null) return false;
  if (direction === "over") return prevA <= prevB && a > b;
  return prevA >= prevB && a < b;
}

const crossover: TaFunction = (args, ctx, named) => {
  const a = num(arg(args, named, 0, "source1", NA));
  const b = num(arg(args, named, 1, "source2", NA));
  const state = ctx.state("cross", () => ({ prevA: null as number | null, prevB: null as number | null }));
  const result = crossImpl(a, b, state.prevA, state.prevB, "over");
  state.prevA = a;
  state.prevB = b;
  return result;
};

const crossunder: TaFunction = (args, ctx, named) => {
  const a = num(arg(args, named, 0, "source1", NA));
  const b = num(arg(args, named, 1, "source2", NA));
  const state = ctx.state("cross", () => ({ prevA: null as number | null, prevB: null as number | null }));
  const result = crossImpl(a, b, state.prevA, state.prevB, "under");
  state.prevA = a;
  state.prevB = b;
  return result;
};

const cross: TaFunction = (args, ctx, named) => {
  const a = num(arg(args, named, 0, "source1", NA));
  const b = num(arg(args, named, 1, "source2", NA));
  const state = ctx.state("cross", () => ({ prevA: null as number | null, prevB: null as number | null }));
  const result = crossImpl(a, b, state.prevA, state.prevB, "over") || crossImpl(a, b, state.prevA, state.prevB, "under");
  state.prevA = a;
  state.prevB = b;
  return result;
};

const highest: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("highest", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  const clean = values.filter((v) => !Number.isNaN(v));
  if (!clean.length) return null;
  return Math.max(...clean);
};

const lowest: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("lowest", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  const clean = values.filter((v) => !Number.isNaN(v));
  if (!clean.length) return null;
  return Math.min(...clean);
};

const highestbars: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("highestbars", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  let bestOffset = -1;
  let bestValue = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) continue;
    if (values[i] > bestValue) {
      bestValue = values[i];
      bestOffset = values.length - 1 - i;
    }
  }
  return bestOffset === -1 ? null : bestOffset;
};

const lowestbars: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 14), 14);
  const state = ctx.state("lowestbars", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  let bestOffset = -1;
  let bestValue = Infinity;
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) continue;
    if (values[i] < bestValue) {
      bestValue = values[i];
      bestOffset = values.length - 1 - i;
    }
  }
  return bestOffset === -1 ? null : bestOffset;
};

const barssince: TaFunction = (args, ctx, named) => {
  const condition = truthy(arg(args, named, 0, "condition", false));
  const state = ctx.state("barssince", () => ({ count: -1 }));
  if (condition) {
    state.count = 0;
    return 0;
  }
  if (state.count < 0) return null;
  state.count += 1;
  return state.count;
};

const valuewhen: TaFunction = (args, ctx, named) => {
  const condition = truthy(arg(args, named, 0, "condition", false));
  const source = num(arg(args, named, 1, "source", NA));
  const occurrence = num(arg(args, named, 2, "occurrence", 0)) ?? 0;
  const state = ctx.state("valuewhen", () => ({ hits: [] as Array<number | null>, count: 0 }));
  if (condition) {
    state.hits.unshift(source);
    state.count += 1;
  }
  const index = Math.floor(occurrence);
  if (index < 0) return null;
  if (index >= state.hits.length) return null;
  return state.hits[index];
};

const pivothigh: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const left = len(arg(args, named, 1, "left", 2), 2);
  const right = len(arg(args, named, 2, "right", 2), 2);
  const state = ctx.state("pivothigh", () => ({ pending: [] as Array<number | null> }));
  state.pending.push(source);
  if (state.pending.length <= right) return null;
  const pivot = state.pending[state.pending.length - 1 - right];
  const window = state.pending.slice(Math.max(0, state.pending.length - left - right - 1), state.pending.length - right);
  if (window.length < left + right + 1) return null;
  const candidate = state.pending[state.pending.length - 1 - right];
  if (candidate === null) return null;
  let isPivot = true;
  for (const value of window) {
    if (value === null) continue;
    if (value > candidate) {
      isPivot = false;
      break;
    }
  }
  void pivot;
  return isPivot ? candidate : null;
};

const pivotlow: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const left = len(arg(args, named, 1, "left", 2), 2);
  const right = len(arg(args, named, 2, "right", 2), 2);
  const state = ctx.state("pivotlow", () => ({ pending: [] as Array<number | null> }));
  state.pending.push(source);
  if (state.pending.length <= right) return null;
  const window = state.pending.slice(Math.max(0, state.pending.length - left - right - 1), state.pending.length - right);
  if (window.length < left + right + 1) return null;
  const candidate = state.pending[state.pending.length - 1 - right];
  if (candidate === null) return null;
  let isPivot = true;
  for (const value of window) {
    if (value === null) continue;
    if (value < candidate) {
      isPivot = false;
      break;
    }
  }
  return isPivot ? candidate : null;
};

/* ------------------------------------------------------------------ */
/* Bands and trend                                                     */
/* ------------------------------------------------------------------ */

const bb: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 20), 20);
  const mult = num(arg(args, named, 2, "mult", 2)) ?? 2;
  const state = ctx.state("bb", () => ({ window: createWindow() }));
  state.window.push(source);
  const values = state.window.tail(length);
  if (values.length < length) return null;
  let sum = 0;
  for (const value of values) {
    if (Number.isNaN(value)) return null;
    sum += value;
  }
  const basis = sum / length;
  let variance = 0;
  for (const value of values) variance += (value - basis) ** 2;
  const deviation = Math.sqrt(variance / length);
  return [basis, basis + mult * deviation, basis - mult * deviation];
};

const keltner: TaFunction = (args, ctx, named) => {
  const source = num(arg(args, named, 0, "source", NA));
  const length = len(arg(args, named, 1, "length", 20), 20);
  const mult = num(arg(args, named, 2, "mult", 2)) ?? 2;
  const useTrueRange = truthy(arg(args, named, 3, "useTrueRange", true));
  const state = ctx.state("keltner", () => ({ ema: null as number | null, atrState: { sum: 0, count: 0, prev: null as number | null } }));
  const alpha = 2 / (length + 1);
  state.ema = state.ema === null ? (source ?? null) : (source ?? state.ema) * alpha + state.ema * (1 - alpha);
  // Wilder ATR, kept locally so the call site does not share state with ta.atr.
  const trueRange = ctx.prevClose === undefined
    ? ctx.bar.high - ctx.bar.low
    : Math.max(
        ctx.bar.high - ctx.bar.low,
        Math.abs(ctx.bar.high - ctx.prevClose),
        Math.abs(ctx.bar.low - ctx.prevClose)
      );
  if (state.atrState.prev === null) {
    state.atrState.sum += trueRange;
    state.atrState.count += 1;
    if (state.atrState.count < length) return [state.ema, null, null];
    state.atrState.prev = state.atrState.sum / length;
  } else {
    state.atrState.prev = (state.atrState.prev * (length - 1) + trueRange) / length;
  }
  const range = useTrueRange ? state.atrState.prev : ctx.bar.high - ctx.bar.low;
  if (state.ema === null || range === null) return [state.ema, null, null];
  return [state.ema, state.ema + mult * range, state.ema - mult * range];
};

const supertrend: TaFunction = (args, ctx, named) => {
  const factor = num(arg(args, named, 0, "factor", 3)) ?? 3;
  const atrPeriod = len(arg(args, named, 1, "atrPeriod", 10), 10);
  const state = ctx.state("supertrend", () => ({
    atr: { sum: 0, count: 0, prev: null as number | null },
    upper: null as number | null,
    lower: null as number | null,
    direction: 1,
    prevClose: null as number | null,
  }));
  const trueRange = ctx.prevClose === undefined
    ? ctx.bar.high - ctx.bar.low
    : Math.max(
        ctx.bar.high - ctx.bar.low,
        Math.abs(ctx.bar.high - ctx.prevClose),
        Math.abs(ctx.bar.low - ctx.prevClose)
      );
  if (state.atr.prev === null) {
    state.atr.sum += trueRange;
    state.atr.count += 1;
    if (state.atr.count < atrPeriod) {
      state.prevClose = ctx.bar.close;
      return [null, state.direction];
    }
    state.atr.prev = state.atr.sum / atrPeriod;
  } else {
    state.atr.prev = (state.atr.prev * (atrPeriod - 1) + trueRange) / atrPeriod;
  }
  const midpoint = (ctx.bar.high + ctx.bar.low) / 2;
  const basicUpper = midpoint + factor * state.atr.prev;
  const basicLower = midpoint - factor * state.atr.prev;
  const prevClose = state.prevClose;
  const upper = state.upper === null || (prevClose !== null && prevClose > state.upper)
    ? basicUpper
    : state.upper;
  const lower = state.lower === null || (prevClose !== null && prevClose < state.lower)
    ? basicLower
    : state.lower;
  let direction = state.direction;
  if (state.upper === null && state.lower === null) {
    direction = 1;
  } else if (ctx.bar.close > upper) {
    direction = 1;
  } else if (ctx.bar.close < lower) {
    direction = -1;
  }
  const value = direction === 1 ? lower : upper;
  state.upper = upper;
  state.lower = lower;
  state.direction = direction;
  state.prevClose = ctx.bar.close;
  return [value, direction];
};

const dmi: TaFunction = (args, ctx, named) => {
  const diLength = len(arg(args, named, 0, "diLength", 14), 14);
  const adxLength = len(arg(args, named, 1, "adxSmoothing", 14), 14);
  const state = ctx.state("dmi", () => ({
    trSum: 0, plusSum: 0, minusSum: 0, count: 0,
    plus: null as number | null, minus: null as number | null, adx: null as number | null,
    adxSum: 0, adxCount: 0,
  }));
  const { high, low, close } = ctx.bar;
  const upMove = ctx.prevClose === undefined ? 0 : high - ctx.prevClose;
  const downMove = ctx.prevClose === undefined ? 0 : ctx.prevClose - low;
  const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
  const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
  const trueRange = ctx.prevClose === undefined
    ? high - low
    : Math.max(high - low, Math.abs(high - ctx.prevClose), Math.abs(low - ctx.prevClose));
  if (state.count < diLength) {
    state.trSum += trueRange;
    state.plusSum += plusDM;
    state.minusSum += minusDM;
    state.count += 1;
    if (state.count < diLength) return [null, null, null];
  } else {
    state.trSum = state.trSum - state.trSum / diLength + trueRange;
    state.plusSum = state.plusSum - state.plusSum / diLength + plusDM;
    state.minusSum = state.minusSum - state.minusSum / diLength + minusDM;
  }
  const plusDI = state.trSum === 0 ? 0 : (state.plusSum / state.trSum) * 100;
  const minusDI = state.trSum === 0 ? 0 : (state.minusSum / state.trSum) * 100;
  const sum = plusDI + minusDI;
  const dx = sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
  if (state.adx === null) {
    state.adxSum += dx;
    state.adxCount += 1;
    if (state.adxCount < adxLength) return [plusDI, minusDI, null];
    state.adx = state.adxSum / adxLength;
  } else {
    state.adx = (state.adx * (adxLength - 1) + dx) / adxLength;
  }
  void close;
  return [plusDI, minusDI, state.adx];
};

const sar: TaFunction = (args, ctx, named) => {
  const start = num(arg(args, named, 0, "start", 0.02)) ?? 0.02;
  const increment = num(arg(args, named, 1, "increment", 0.02)) ?? 0.02;
  const maximum = num(arg(args, named, 2, "max", 0.2)) ?? 0.2;
  const state = ctx.state("sar", () => ({
    sar: null as number | null,
    ep: null as number | null,
    af: start,
    isLong: true,
  }));
  const { high, low } = ctx.bar;
  if (state.sar === null) {
    // Seed from the first two bars: assume the direction of the first move.
    if (ctx.bars.length < 2) return null;
    const first = ctx.bars[0];
    const second = ctx.bars[1];
    state.isLong = second.close >= first.close;
    state.sar = state.isLong ? first.low : first.high;
    state.ep = state.isLong ? first.high : first.low;
    state.af = start;
    return state.sar;
  }
  state.sar = state.isLong
    ? Math.min(state.sar, ctx.prevClose ?? state.sar)
    : Math.max(state.sar, ctx.prevClose ?? state.sar);
  if (state.isLong) {
    if (high > (state.ep as number)) {
      state.ep = high;
      state.af = Math.min(maximum, state.af + increment);
    }
    state.sar += state.af * ((state.ep as number) - state.sar);
    if (low < state.sar) {
      state.isLong = false;
      state.sar = state.ep as number;
      state.ep = low;
      state.af = start;
    }
  } else {
    if (low < (state.ep as number)) {
      state.ep = low;
      state.af = Math.min(maximum, state.af + increment);
    }
    state.sar -= state.af * ((state.sar) - (state.ep as number));
    if (high > state.sar) {
      state.isLong = true;
      state.sar = state.ep as number;
      state.ep = high;
      state.af = start;
    }
  }
  return state.sar;
};

/* ------------------------------------------------------------------ */

export const TA_FUNCTIONS: Record<string, TaFunction> = {
  sma, ema, rma, wma, vwma, hma, swma, alma, dema, tema, linreg,
  tr, atr, stdev, variance, dev, median, mode, percentrank,
  percentile_linear_interpolation: percentileLinear,
  percentile_nearest_rank: percentileNearest,
  correlation,
  rsi, macd, stoch, cci, mfi, wpr, mom, roc, change, cum, sum,
  crossover, crossunder, cross, highest, lowest, highestbars, lowestbars,
  barssince, valuewhen, pivothigh, pivotlow, bb, keltner, supertrend, dmi, sar,
};

