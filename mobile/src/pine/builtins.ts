/**
 * Pine built-in namespaces: math, str, color, array, input, time, syminfo,
 * request.security and the constant namespaces (plot styles, locations,
 * shapes, display modes).
 *
 * Everything here is a plain function of (args, context) so the evaluator can
 * dispatch namespace calls without knowing what they do.
 */
import type { PineHost, PineInput } from "./host";
import {
  type PineValue, isArray, isColor, toBoolean, toDisplayString, toNumber, truthy,
  type PineArray, type PineColor, type PineCallable, type PineDrawing, type PineProperty,
} from "./values";

export interface BuiltinContext {
  site: number;
  named: Map<string, PineValue>;
  host: PineHost;
  /** Unique-ish id generator for input ids. */
  nextId(prefix: string): string;
  /** Explicit type arguments: `array.new<SRZone>()`. */
  typeArgs?: string[];
}

export type BuiltinFn = (args: PineValue[], ctx: BuiltinContext) => PineValue;

/**
 * A namespace member is one of:
 *   - a function, called with `ns.fn(...)`
 *   - a constant (`plot.style_line`, `strategy.long`, `color.red`)
 *   - a live property (`strategy.position_size`), readable and assignable
 *   - a callable with methods (`strategy.opentrades.entry_price(0)`)
 */
export type NamespaceEntry = BuiltinFn | PineValue | PineProperty | PineCallable;

export function isBuiltinFn(entry: unknown): entry is BuiltinFn {
  return typeof entry === "function";
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

function n(value: PineValue, fallback = 0): number {
  const parsed = toNumber(value);
  return parsed === null ? fallback : parsed;
}

/* ------------------------------------------------------------------ */
/* math.*                                                              */
/* ------------------------------------------------------------------ */

const math: Record<string, BuiltinFn> = {
  abs: (args) => {
    const value = toNumber(args[0]);
    return value === null ? null : Math.abs(value);
  },
  ceil: (args) => {
    const value = toNumber(args[0]);
    return value === null ? null : Math.ceil(value);
  },
  floor: (args) => {
    const value = toNumber(args[0]);
    return value === null ? null : Math.floor(value);
  },
  round: (args, ctx) => {
    const value = toNumber(arg(args, ctx.named, 0, "value", 0));
    if (value === null) return null;
    const precision = n(arg(args, ctx.named, 1, "precision", 0));
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
  },
  sign: (args) => {
    const value = toNumber(args[0]);
    if (value === null) return null;
    return Math.sign(value);
  },
  sqrt: (args) => {
    const value = toNumber(args[0]);
    if (value === null) return null;
    return value < 0 ? null : Math.sqrt(value);
  },
  pow: (args) => {
    const base = toNumber(args[0]);
    const exponent = toNumber(args[1]);
    if (base === null || exponent === null) return null;
    return base ** exponent;
  },
  log: (args) => {
    const value = toNumber(args[0]);
    if (value === null || value <= 0) return null;
    return Math.log(value);
  },
  log10: (args) => {
    const value = toNumber(args[0]);
    if (value === null || value <= 0) return null;
    return Math.log10(value);
  },
  exp: (args) => {
    const value = toNumber(args[0]);
    return value === null ? null : Math.exp(value);
  },
  max: (args) => {
    let best: number | null = null;
    for (const value of args) {
      const parsed = toNumber(value);
      if (parsed === null) return null;
      if (best === null || parsed > best) best = parsed;
    }
    return best;
  },
  min: (args) => {
    let best: number | null = null;
    for (const value of args) {
      const parsed = toNumber(value);
      if (parsed === null) return null;
      if (best === null || parsed < best) best = parsed;
    }
    return best;
  },
  sum: (args) => {
    let total = 0;
    for (const value of args) {
      const parsed = toNumber(value);
      if (parsed === null) return null;
      total += parsed;
    }
    return total;
  },
  avg: (args) => {
    let total = 0;
    for (const value of args) {
      const parsed = toNumber(value);
      if (parsed === null) return null;
      total += parsed;
    }
    return args.length ? total / args.length : null;
  },
  median: (args) => {
    const values = args.map(toNumber).filter((v): v is number => v !== null);
    if (!values.length) return null;
    values.sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  },
  mode: (args) => {
    const values = args.map(toNumber).filter((v): v is number => v !== null);
    if (!values.length) return null;
    const counts = new Map<number, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    let best = values[0];
    let bestCount = 0;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  },
  acos: (args) => {
    const value = toNumber(args[0]);
    if (value === null || value < -1 || value > 1) return null;
    return Math.acos(value);
  },
  asin: (args) => {
    const value = toNumber(args[0]);
    if (value === null || value < -1 || value > 1) return null;
    return Math.asin(value);
  },
  atan: (args) => {
    const value = toNumber(args[0]);
    return value === null ? null : Math.atan(value);
  },
  random: (args, ctx) => {
    // Deterministic per call site: a strategy must replay identically.
    const state = ctx.host as unknown as { __random?: Map<number, number> };
    void state;
    const store = RANDOM_STATES.get(ctx.site) ?? { value: 0 };
    store.value = (store.value * 9301 + 49297) % 233280;
    RANDOM_STATES.set(ctx.site, store);
    return store.value / 233280;
  },
  e: () => Math.E,
  pi: () => Math.PI,
  phi: () => (1 + Math.sqrt(5)) / 2,
  rphi: () => (1 + Math.sqrt(5)) / 2,
};

const RANDOM_STATES = new Map<number, { value: number }>();

/* ------------------------------------------------------------------ */
/* str.*                                                               */
/* ------------------------------------------------------------------ */

const str: Record<string, BuiltinFn> = {
  format: (args) => {
    const template = typeof args[0] === "string" ? args[0] : "";
    const rest = args.slice(1);
    let index = 0;
    return template.replace(/\{[^{}]*\}/g, () => {
      const value = rest[index++];
      return toDisplayString(value ?? null);
    });
  },
  contains: (args) => typeof args[0] === "string" && typeof args[1] === "string" && args[0].includes(args[1]),
  startswith: (args) => typeof args[0] === "string" && typeof args[1] === "string" && args[0].startsWith(args[1]),
  endswith: (args) => typeof args[0] === "string" && typeof args[1] === "string" && args[0].endsWith(args[1]),
  length: (args) => (typeof args[0] === "string" ? args[0].length : null),
  lower: (args) => (typeof args[0] === "string" ? args[0].toLowerCase() : null),
  upper: (args) => (typeof args[0] === "string" ? args[0].toUpperCase() : null),
  replace: (args) => {
    if (typeof args[0] !== "string") return null;
    return args[0].split(String(args[1] ?? "")).join(String(args[2] ?? ""));
  },
  split: (args) => {
    if (typeof args[0] !== "string") return null;
    return args[0].split(String(args[1] ?? ","));
  },
  substring: (args) => {
    if (typeof args[0] !== "string") return null;
    const from = n(args[1]);
    const to = args.length > 2 ? n(args[2]) : args[0].length;
    return args[0].slice(from, to);
  },
  tonumber: (args) => toNumber(args[0]),
  /**
   * `str.tostring(value, format)`. The format is a number pattern such as
   * "#.#" (one decimal) or a named format such as "mintick".
   */
  tostring: (args) => {
    const value = args[0] ?? null;
    const format = typeof args[1] === "string" ? args[1] : null;
    if (!format) return toDisplayString(value);
    const number = toNumber(value);
    if (number === null) return toDisplayString(value);
    if (format === "mintick" || format === "price") return number.toFixed(2);
    if (format === "percent") return `${number.toFixed(2)}%`;
    if (format === "volume") return number.toFixed(0);
    const pattern = /^#(\.#*)?$/.exec(format);
    if (pattern) {
      const decimals = (pattern[1] ?? "").length - 1;
      return number.toFixed(Math.max(0, decimals));
    }
    const integerPattern = /^#+(\.#*)?$/.exec(format);
    if (integerPattern) {
      const decimals = (integerPattern[1] ?? "").length - 1;
      return number.toFixed(Math.max(0, decimals));
    }
    return toDisplayString(value);
  },
  replace_all: (args) => {
    if (typeof args[0] !== "string") return null;
    return args[0].split(String(args[1] ?? "")).join(String(args[2] ?? ""));
  },
};

/* ------------------------------------------------------------------ */
/* color.*                                                             */
/* ------------------------------------------------------------------ */

const NAMED_COLORS: Record<string, PineColor> = {
  aqua: { r: 0, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
  blue: { r: 0, g: 0, b: 255, a: 1 },
  brown: { r: 165, g: 42, b: 42, a: 1 },
  chartreuse: { r: 127, g: 255, b: 0, a: 1 },
  coral: { r: 255, g: 127, b: 80, a: 1 },
  crimson: { r: 220, g: 20, b: 60, a: 1 },
  fuchsia: { r: 255, g: 0, b: 255, a: 1 },
  gold: { r: 255, g: 215, b: 0, a: 1 },
  gray: { r: 128, g: 128, b: 128, a: 1 },
  green: { r: 0, g: 128, b: 0, a: 1 },
  indigo: { r: 75, g: 0, b: 130, a: 1 },
  lime: { r: 0, g: 255, b: 0, a: 1 },
  maroon: { r: 128, g: 0, b: 0, a: 1 },
  navy: { r: 0, g: 0, b: 128, a: 1 },
  olive: { r: 128, g: 128, b: 0, a: 1 },
  orange: { r: 255, g: 165, b: 0, a: 1 },
  purple: { r: 128, g: 0, b: 128, a: 1 },
  red: { r: 255, g: 0, b: 0, a: 1 },
  silver: { r: 192, g: 192, b: 192, a: 1 },
  sky: { r: 135, g: 206, b: 235, a: 1 },
  teal: { r: 0, g: 128, b: 128, a: 1 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  yellow: { r: 255, g: 255, b: 0, a: 1 },
};

const color: Record<string, NamespaceEntry> = {
  rgb: (args) => {
    const r = n(args[0]);
    const g = n(args[1]);
    const b = n(args[2]);
    const a = args.length > 3 ? n(args[3], 1) : 1;
    return { r, g, b, a } satisfies PineColor;
  },
  r: (args) => (isColor(args[0]) ? args[0].r : null),
  g: (args) => (isColor(args[0]) ? args[0].g : null),
  b: (args) => (isColor(args[0]) ? args[0].b : null),
  new: (args) => {
    const base = isColor(args[0])
      ? args[0]
      : typeof args[0] === "string" && args[0].startsWith("#")
        ? hexToColor(args[0])
        : { r: 0, g: 0, b: 0, a: 1 };
    const transparency = n(args[1], 0);
    return { ...base, a: Math.max(0, Math.min(1, 1 - transparency / 100)) } satisfies PineColor;
  },
  from_gradient: (args) => (isColor(args[0]) ? args[0] : null),
  ...NAMED_COLORS,
};

/* ------------------------------------------------------------------ */
/* array.*                                                             */
/* ------------------------------------------------------------------ */

function asArray(value: PineValue): PineValue[] | null {
  return Array.isArray(value) ? value : null;
}

/** The elements of a Pine array (`array.new<T>()`) or a plain array. */
function itemsOf(value: PineValue): PineValue[] | null {
  if (isArray(value)) return value.items;
  return Array.isArray(value) ? value : null;
}

/** A hex colour literal, as produced by the lexer (`#ff9800`). */
export function hexToColor(hex: string): PineColor {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return { r: 128, g: 128, b: 128, a: 1 };
  }
  return { r, g, b, a: 1 };
}

const array: Record<string, BuiltinFn> = {
  /** `array.new<T>()` — an empty array, optionally typed. */
  new: (_args, ctx) => {
    const created: PineArray = { __array: true, typeName: ctx.typeArgs?.[0] ?? null, items: [] };
    return created as unknown as PineValue;
  },
  from: (args) => {
    const source = itemsOf(args[0]);
    const created: PineArray = { __array: true, typeName: null, items: source ? [...source] : [] };
    return created as unknown as PineValue;
  },
  concat: (args) => {
    const target = itemsOf(args[0]);
    const other = itemsOf(args[1]);
    if (target && other) target.push(...other);
    return null;
  },
  new_float: (args) => new Array(Math.max(0, Math.floor(n(args[0])))).fill(0),
  new_int: (args) => new Array(Math.max(0, Math.floor(n(args[0])))).fill(0),
  new_bool: (args) => new Array(Math.max(0, Math.floor(n(args[0])))).fill(false),
  new_string: (args) => new Array(Math.max(0, Math.floor(n(args[0])))).fill(""),
  push: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return null;
    target.push(args[1] ?? null);
    return null;
  },
  pop: (args) => {
    const target = itemsOf(args[0]);
    if (!target || !target.length) return null;
    return target.pop() ?? null;
  },
  get: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return null;
    const index = Math.floor(n(args[1]));
    return index >= 0 && index < target.length ? target[index] : null;
  },
  set: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return null;
    const index = Math.floor(n(args[1]));
    if (index >= 0 && index < target.length) target[index] = args[2] ?? null;
    return null;
  },
  size: (args) => {
    const target = itemsOf(args[0]);
    return target ? target.length : null;
  },
  shift: (args) => {
    const target = itemsOf(args[0]);
    if (!target || !target.length) return null;
    return target.shift() ?? null;
  },
  unshift: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return null;
    target.unshift(args[1] ?? null);
    return null;
  },
  insert: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return null;
    const index = Math.floor(n(args[1]));
    target.splice(index, 0, args[2] ?? null);
    return null;
  },
  remove: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return null;
    const index = Math.floor(n(args[1]));
    if (index >= 0 && index < target.length) return target.splice(index, 1)[0] ?? null;
    return null;
  },
  clear: (args) => {
    const target = itemsOf(args[0]);
    if (target) target.length = 0;
    return null;
  },
  slice: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return null;
    return target.slice(Math.floor(n(args[1], 0)), args.length > 2 ? Math.floor(n(args[2])) : undefined);
  },
  includes: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return false;
    return target.some((value) => value === args[1]);
  },
  indexof: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return null;
    const index = target.indexOf(args[1]);
    return index === -1 ? null : index;
  },
  lastindexof: (args) => {
    const target = itemsOf(args[0]);
    if (!target) return null;
    for (let index = target.length - 1; index >= 0; index--) {
      if (target[index] === args[1]) return index;
    }
    return null;
  },
  copy: (args) => {
    const target = itemsOf(args[0]);
    return target ? [...target] : null;
  },
  sort: (args) => {
    const target = asArray(args[0]);
    if (target) target.sort((a, b) => n(a) - n(b));
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* input.*                                                             */
/* ------------------------------------------------------------------ */

type InputType = PineInput["type"];

function makeInput(type: InputType, coerce: (value: PineValue) => PineValue): BuiltinFn {
  return (args, ctx) => {
    // Pine v5 order: (defval, title, ...). Pine v6 also allows (title, defval).
    let defval = args[0] ?? null;
    let title = typeof args[1] === "string" ? args[1] : "";
    if (typeof args[0] === "string" && args.length > 1) {
      title = args[0];
      defval = args[1];
    }
    const namedTitle = ctx.named.get("title");
    if (typeof namedTitle === "string") title = namedTitle;
    const namedDefval = ctx.named.get("defval");
    if (namedDefval !== undefined) defval = namedDefval;

    const id = ctx.nextId(`input.${type}`);
    const coerced = coerce(defval);
    const input: PineInput = {
      id,
      title: title || id,
      type,
      defval: coerced,
      value: coerced,
    };
    const minval = toNumber(ctx.named.get("minval") ?? null);
    const maxval = toNumber(ctx.named.get("maxval") ?? null);
    const step = toNumber(ctx.named.get("step") ?? null);
    if (minval !== null) input.minval = minval;
    if (maxval !== null) input.maxval = maxval;
    if (step !== null) input.step = step;
    const options = ctx.named.get("options") ?? null;
    if (Array.isArray(options)) input.options = options.map((option) => toDisplayString(option));

    ctx.host.recordInput(input);
    return ctx.host.inputValue(id, coerced);
  };
}

const input: Record<string, BuiltinFn> = {
  int: makeInput("int", (value) => Math.trunc(toNumber(value) ?? 0)),
  float: makeInput("float", (value) => toNumber(value) ?? 0),
  bool: makeInput("bool", (value) => toBoolean(value)),
  string: makeInput("string", (value) => (typeof value === "string" ? value : toDisplayString(value))),
  color: makeInput("color", (value) => (isColor(value) ? value : NAMED_COLORS.teal)),
  source: makeInput("source", (value) => (typeof value === "string" ? value : "close")),
  timeframe: makeInput("timeframe", (value) => (typeof value === "string" ? value : "5")),
  price: makeInput("price", (value) => toNumber(value) ?? 0),
  time: makeInput("time", (value) => (typeof value === "string" ? value : "1970-01-01T00:00:00Z")),
  session: makeInput("session", (value) => (typeof value === "string" ? value : "0000-0000")),
  text_area: makeInput("string", (value) => (typeof value === "string" ? value : toDisplayString(value))),
};

/* ------------------------------------------------------------------ */
/* time / syminfo / timeframe / barstate / request                      */
/* ------------------------------------------------------------------ */

const time: Record<string, BuiltinFn> = {
  year: (args, ctx) => new Date(n(args[0], ctx.host.bar().time) * 1000).getUTCFullYear(),
  month: (args, ctx) => new Date(n(args[0], ctx.host.bar().time) * 1000).getUTCMonth() + 1,
  dayofmonth: (args, ctx) => new Date(n(args[0], ctx.host.bar().time) * 1000).getUTCDate(),
  dayofweek: (args, ctx) => new Date(n(args[0], ctx.host.bar().time) * 1000).getUTCDay() + 1,
  hour: (args, ctx) => new Date(n(args[0], ctx.host.bar().time) * 1000).getUTCHours(),
  minute: (args, ctx) => new Date(n(args[0], ctx.host.bar().time) * 1000).getUTCMinutes(),
  second: (args, ctx) => new Date(n(args[0], ctx.host.bar().time) * 1000).getUTCSeconds(),
};

const syminfo: Record<string, BuiltinFn> = {
  type: () => "futures",
  mintick: () => 0.1,
  pointvalue: () => 1,
  prefix: () => "",
  ticker: (_args, ctx) => ctx.host.symbol(),
  currency: () => "INR",
  timezone: () => "Asia/Kolkata",
  volvaluetype: () => "tick",
  type_key: () => "futures",
  description: (_args, ctx) => ctx.host.symbol(),
};

const timeframe: Record<string, BuiltinFn> = {
  in_seconds: (_args, ctx) => timeframeSeconds(ctx.host.timeframe()),
  /**
   * `timeframe.change("1D")` — true on the first bar of a new period. It is
   * what an anchored VWAP resets on.
   */
  change: (args, ctx) => {
    const requested = typeof args[0] === "string" ? args[0] : ctx.host.timeframe();
    const period = timeframeSeconds(requested);
    if (period <= 0) return false;
    const current = Math.floor(ctx.host.bar().time / period);
    const previous = ctx.host.previousBarTime();
    if (previous === null) return true;
    return current !== Math.floor(previous / period);
  },
  multiplier: (_args, ctx) => timeframeMultiplier(ctx.host.timeframe()),
  period: (_args, ctx) => ctx.host.timeframe(),
  isintraday: (_args, ctx) => timeframeSeconds(ctx.host.timeframe()) < 86400,
  isdaily: (_args, ctx) => timeframeSeconds(ctx.host.timeframe()) === 86400,
  isweekly: (_args, ctx) => timeframeSeconds(ctx.host.timeframe()) === 604800,
  ismonthly: (_args, ctx) => timeframeSeconds(ctx.host.timeframe()) === 2592000,
  isseconds: (_args, ctx) => timeframeSeconds(ctx.host.timeframe()) === 1,
  isminutes: (_args, ctx) => timeframeSeconds(ctx.host.timeframe()) === 60,
};

/**
 * `barstate.*` are values, not functions: `barstate.islast` is read directly.
 */
const barstate: Record<string, NamespaceEntry> = {
  isconfirmed: { __property: true, get: () => true, set: () => undefined },
  islast: {
    __property: true,
    get: (host) => !!host && host.barIndex() === host.lastBarIndex(),
    set: () => undefined,
  },
  isfirst: {
    __property: true,
    get: (host) => !!host && host.barIndex() === 0,
    set: () => undefined,
  },
  isnew: {
    __property: true,
    get: (host) => !!host && host.barIndex() === 0,
    set: () => undefined,
  },
  isrealtime: { __property: true, get: () => false, set: () => undefined },
  ishistory: {
    __property: true,
    get: (host) => !!host && host.barIndex() < host.lastBarIndex(),
    set: () => undefined,
  },
};

const request: Record<string, BuiltinFn> = {
  security: (args, ctx) => {
    const requested = typeof args[1] === "string" ? args[1] : ctx.host.timeframe();
    return ctx.host.securityCall(requested, args[2] ?? null);
  },
  security_lower_tf: (args, ctx) => ctx.host.securityCall(typeof args[1] === "string" ? args[1] : ctx.host.timeframe(), args[2] ?? null),
  dividend: () => null,
  earnings: () => null,
  splits: () => null,
  financial: () => null,
  economic: () => null,
  seed: (_args, ctx) => ctx.host.bar().time,
};

/* ------------------------------------------------------------------ */
/* Drawing objects: box, label, table                                 */
/* ------------------------------------------------------------------ */


/**
 * A drawing is a live object: the script keeps the reference and mutates it
 * (`box.set_top(id, price)`), and the app draws the final state.
 */
function drawing(id: number, kind: PineDrawing["__drawing"], fields: Record<string, unknown>): PineDrawing {
  return { __drawing: kind, id, deleted: false, ...fields } as PineDrawing;
}

/** Read a numeric field of a drawing. */
function drawingNumber(value: PineValue, field: string): number | null {
  const target = asDrawing(value);
  if (!target) return null;
  return toNumber(target[field] as PineValue);
}

function asDrawing(value: PineValue): PineDrawing | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as PineDrawing;
  return "__drawing" in candidate ? candidate : null;
}

const box: Record<string, BuiltinFn> = {
  new: (args, ctx) => {
    const id = ctx.nextId("box");
    // Pine allows both positional and named arguments here:
    //   box.new(left, top, right, bottom, border_color, border_width, bgcolor, ...)
    const created = drawing(Number(id.replace(/\D/g, "")) || id.length, "box", {
      left: n(arg(args, ctx.named, 0, "left", null)),
      top: n(arg(args, ctx.named, 1, "top", null)),
      right: n(arg(args, ctx.named, 2, "right", null)),
      bottom: n(arg(args, ctx.named, 3, "bottom", null)),
      borderColor: arg(args, ctx.named, 4, "border_color", null),
      borderWidth: n(arg(args, ctx.named, 5, "border_width", null), 1),
      bgcolor: arg(args, ctx.named, 6, "bgcolor", null),
      text: String(arg(args, ctx.named, 7, "text", "")),
      textColor: arg(args, ctx.named, 8, "text_color", null),
      xloc: (ctx.named.get("xloc") as string) ?? "bar_index",
    });
    ctx.host.recordDrawing(created);
    return created as unknown as PineValue;
  },
  set_top: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.top = n(args[1]);
    return null;
  },
  set_bottom: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.bottom = n(args[1]);
    return null;
  },
  set_left: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.left = n(args[1]);
    return null;
  },
  set_right: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.right = n(args[1]);
    return null;
  },
  set_bgcolor: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.bgcolor = args[1] ?? null;
    return null;
  },
  set_border_color: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.borderColor = args[1] ?? null;
    return null;
  },
  set_border_width: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.borderWidth = n(args[1], 1);
    return null;
  },
  set_text: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.text = typeof args[1] === "string" ? args[1] : "";
    return null;
  },
  set_text_color: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.textColor = args[1] ?? null;
    return null;
  },
  delete: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.deleted = true;
    return null;
  },
  get_top: (args) => drawingNumber(args[0], "top"),
  get_bottom: (args) => drawingNumber(args[0], "bottom"),
  get_left: (args) => drawingNumber(args[0], "left"),
  get_right: (args) => drawingNumber(args[0], "right"),
};

const label: Record<string, NamespaceEntry> = {
  new: (args, ctx) => {
    const id = ctx.nextId("label");
    // label.new(x, y, text, xloc, yloc, color, style, textcolor, size, ...)
    const created = drawing(Number(id.replace(/\D/g, "")) || id.length, "label", {
      x: n(arg(args, ctx.named, 0, "x", null)),
      y: n(arg(args, ctx.named, 1, "y", null)),
      text: String(arg(args, ctx.named, 2, "text", "")),
      xloc: (arg(args, ctx.named, 3, "xloc", null) as string) ?? "bar_index",
      yloc: (arg(args, ctx.named, 4, "yloc", null) as string) ?? "price",
      color: arg(args, ctx.named, 5, "color", null),
      style: (arg(args, ctx.named, 6, "style", null) as string) ?? "label_down",
      textcolor: arg(args, ctx.named, 7, "textcolor", null),
      size: (arg(args, ctx.named, 8, "size", null) as string) ?? "normal",
    });
    ctx.host.recordDrawing(created);
    return created as unknown as PineValue;
  },
  set_x: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.x = n(args[1]);
    return null;
  },
  set_y: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.y = n(args[1]);
    return null;
  },
  set_text: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.text = typeof args[1] === "string" ? args[1] : "";
    return null;
  },
  set_color: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.color = args[1] ?? null;
    return null;
  },
  set_textcolor: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.textColor = args[1] ?? null;
    return null;
  },
  set_style: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.style = args[1] ?? "label_down";
    return null;
  },
  set_size: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.size = args[1] ?? "normal";
    return null;
  },
  delete: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.deleted = true;
    return null;
  },
  // Label styles.
  style_none: "none",
  style_normal: "normal",
  style_label_up: "label_up",
  style_label_down: "label_down",
  style_label_left: "label_left",
  style_label_right: "label_right",
  style_label_lower_left: "label_lower_left",
  style_label_lower_right: "label_lower_right",
  style_label_upper_left: "label_upper_left",
  style_label_upper_right: "label_upper_right",
  style_label_center: "label_center",
  style_circle: "circle",
  style_square: "square",
  style_text_outline: "text_outline",
  style_xcross: "xcross",
  style_cross: "cross",
  style_triangleup: "triangleup",
  style_triangledown: "triangledown",
  style_flag: "flag",
  style_arrowup: "arrowup",
  style_arrowdown: "arrowdown",
};

const table: Record<string, BuiltinFn> = {
  new: (args, ctx) => {
    const id = ctx.nextId("table");
    // table.new(position, rows, columns, bgcolor, frame_color, ...)
    const created = drawing(Number(id.replace(/\D/g, "")) || id.length, "table", {
      position: (arg(args, ctx.named, 0, "position", null) as string) ?? "top_right",
      rows: n(arg(args, ctx.named, 1, "rows", null), 1),
      columns: n(arg(args, ctx.named, 2, "columns", null), 1),
      bgcolor: arg(args, ctx.named, 3, "bgcolor", null),
      borderColor: arg(args, ctx.named, 5, "border_color", null),
      borderWidth: n(arg(args, ctx.named, 6, "border_width", null), 1),
      cells: [] as Array<Record<string, unknown>>,
    });
    ctx.host.recordDrawing(created);
    return created as unknown as PineValue;
  },
  cell: (args, ctx) => {
    const target = asDrawing(args[0]);
    if (!target) return null;
    const cells = (target.cells as Array<Record<string, unknown>>) ?? [];
    const column = Math.floor(n(args[1]));
    const row = Math.floor(n(args[2]));
    const cell = {
      column,
      row,
      text: typeof args[3] === "string" ? args[3] : "",
      textColor: ctx.named.get("text_color") ?? null,
      bgcolor: ctx.named.get("bgcolor") ?? null,
      size: ctx.named.get("text_size") ?? "normal",
      halign: ctx.named.get("text_halign") ?? "left",
    };
    const existing = cells.findIndex((entry) => entry.column === column && entry.row === row);
    if (existing >= 0) cells[existing] = cell;
    else cells.push(cell);
    target.cells = cells;
    return null;
  },
  cell_set_text: (args) => {
    const target = asDrawing(args[0]);
    if (!target) return null;
    const cells = (target.cells as Array<Record<string, unknown>>) ?? [];
    const cell = cells.find(
      (entry) => entry.column === Math.floor(n(args[1])) && entry.row === Math.floor(n(args[2]))
    );
    if (cell) cell.text = typeof args[3] === "string" ? args[3] : "";
    return null;
  },
  cell_set_bgcolor: (args) => {
    const target = asDrawing(args[0]);
    if (!target) return null;
    const cells = (target.cells as Array<Record<string, unknown>>) ?? [];
    const cell = cells.find(
      (entry) => entry.column === Math.floor(n(args[1])) && entry.row === Math.floor(n(args[2]))
    );
    if (cell) cell.bgcolor = args[3] ?? null;
    return null;
  },
  cell_set_text_color: (args) => {
    const target = asDrawing(args[0]);
    if (!target) return null;
    const cells = (target.cells as Array<Record<string, unknown>>) ?? [];
    const cell = cells.find(
      (entry) => entry.column === Math.floor(n(args[1])) && entry.row === Math.floor(n(args[2]))
    );
    if (cell) cell.textColor = args[3] ?? null;
    return null;
  },
  delete: (args) => {
    const target = asDrawing(args[0]);
    if (target) target.deleted = true;
    return null;
  },
};

/* ------------------------------------------------------------------ */
/* Constant namespaces                                                 */
/* ------------------------------------------------------------------ */

export const plotStyles: Record<string, string> = {
  style_line: "line",
  style_linebr: "linebr",
  style_histogram: "histogram",
  style_cross: "cross",
  style_stepline: "stepline",
  style_stepline_diamond: "stepline_diamond",
  style_areabr: "areabr",
  style_columns: "columns",
  style_circles: "circles",
};

/** `plot.style_line` and friends are constants, not calls. */
export const plot: Record<string, NamespaceEntry> = { ...plotStyles };

export const display: Record<string, NamespaceEntry> = {
  none: "none",
  all: "all",
  data_window: "data_window",
  pane: "pane",
  status_line: "status_line",
  price_scale: "price_scale",
  drawing: "drawing",
};

export const format: Record<string, NamespaceEntry> = {
  inherit: "inherit",
  price: "price",
  volume: "volume",
  percent: "percent",
  mintick: "mintick",
};

export const location: Record<string, NamespaceEntry> = {
  abovebar: "abovebar",
  belowbar: "belowbar",
  top: "top",
  bottom: "bottom",
  absolute: "absolute",
  top_bar: "top_bar",
  bottom_bar: "bottom_bar",
};

export const shape: Record<string, NamespaceEntry> = {
  xcross: "xcross",
  cross: "cross",
  triangleup: "triangleup",
  triangledown: "triangledown",
  flag: "flag",
  circle: "circle",
  arrowup: "arrowup",
  arrowdown: "arrowdown",
  labelup: "labelup",
  labeldown: "labeldown",
  square: "square",
  circlehollow: "circlehollow",
};

export const orderSide: Record<string, string> = { buy: "buy", sell: "sell" };
export const orderType: Record<string, string> = {
  market: "market",
  limit: "limit",
  stop: "stop",
  stoplimit: "stoplimit",
};
export const alertFreq: Record<string, NamespaceEntry> = {
  freq_once_per_bar: "once_per_bar",
  freq_once_per_bar_close: "once_per_bar_close",
  freq_all: "all",
};
export const scale: Record<string, NamespaceEntry> = { right: "right", left: "left", none: "none" };
export const extend: Record<string, NamespaceEntry> = {
  none: "none",
  left: "left",
  right: "right",
  both: "both",
};
/**
 * Pine spells the line styles `line.style_solid`, `hline.style_dotted` and so
 * on; the short names are kept as well because older scripts use them.
 */
export const lineStyle: Record<string, NamespaceEntry> = {
  style_solid: "solid",
  style_dotted: "dotted",
  style_dashed: "dashed",
  style_arrow_left: "arrow_left",
  style_arrow_right: "arrow_right",
  style_arrow_both: "arrow_both",
  solid: "solid",
  dotted: "dotted",
  dashed: "dashed",
  arrow_left: "arrow_left",
  arrow_right: "arrow_right",
  arrow_both: "arrow_both",
};
export const hlineStyle: Record<string, NamespaceEntry> = {
  style_solid: "solid",
  style_dotted: "dotted",
  style_dashed: "dashed",
  solid: "solid",
  dotted: "dotted",
  dashed: "dashed",
};

/* ------------------------------------------------------------------ */
/* Timeframe helpers                                                   */
/* ------------------------------------------------------------------ */

const TIMEFRAME_MINUTES: Record<string, number> = {
  "1": 1, "3": 3, "5": 5, "15": 15, "30": 30, "60": 60, "120": 120, "240": 240,
  D: 1440, W: 10080, M: 43200,
};

/**
 * Seconds in a timeframe. Both TradingView's spelling ("15", "60", "1D") and
 * the app's own ("15m", "1h", "4h", "1d") are understood.
 */
export function timeframeSeconds(timeframe: string): number {
  const text = timeframe.trim();
  const match = /^(\d+)?\s*([mhdwM])?$/.exec(text);
  if (match) {
    const multiplier = match[1] ? Number(match[1]) : 1;
    const unit = match[2] ?? "m";
    if (unit === "h") return multiplier * 3600;
    if (unit === "d") return multiplier * 86400;
    if (unit === "w" || unit === "M") return multiplier * 604800;
    return multiplier * 60;
  }
  const legacy = /^(\d+)?([DWM])?$/.exec(text);
  if (!legacy) return 60;
  const multiplier = legacy[1] ? Number(legacy[1]) : 1;
  const unit = legacy[2] ?? "m";
  const minutes = TIMEFRAME_MINUTES[unit] ?? 1;
  return multiplier * minutes * 60;
}

export function timeframeMultiplier(timeframe: string): number {
  const match = /^(\d+)/.exec(timeframe.trim());
  return match ? Number(match[1]) : 1;
}

/* ------------------------------------------------------------------ */

export const NAMESPACES: Record<string, Record<string, NamespaceEntry>> = {
  math,
  str,
  color,
  array,
  input,
  time,
  syminfo,
  timeframe,
  barstate,
  request,
  plot,
  display,
  format,
  location,
  shape,
  order: { ...orderSide, ...orderType, side: orderSide, type: orderType },
  box,
  label,
  table,
  size: {
    auto: "auto",
    tiny: "tiny",
    small: "small",
    normal: "normal",
    large: "large",
    huge: "huge",
  } as Record<string, NamespaceEntry>,
  text: {
    align_left: "left",
    align_center: "center",
    align_right: "right",
  } as Record<string, NamespaceEntry>,
  position: {
    top_left: "top_left",
    top_center: "top_center",
    top_right: "top_right",
    middle_left: "middle_left",
    middle_center: "middle_center",
    middle_right: "middle_right",
    bottom_left: "bottom_left",
    bottom_center: "bottom_center",
    bottom_right: "bottom_right",
  } as Record<string, NamespaceEntry>,
  xloc: {
    bar_index: "bar_index",
    bar_time: "bar_time",
    price: "price",
  } as Record<string, NamespaceEntry>,
  yloc: {
    price: "price",
    abovebar: "abovebar",
    belowbar: "belowbar",
  } as Record<string, NamespaceEntry>,
  alert: alertFreq,
  scale,
  extend,
  hline: hlineStyle,
  line: lineStyle,
  matrix: {},
  map: {},
};

export { NAMED_COLORS };
