/**
 * Pine value model.
 *
 * Pine has four scalar types plus na. This module models them as:
 *   number  -> JS number (int and float are the same at runtime)
 *   boolean -> JS boolean
 *   string  -> JS string
 *   color   -> PineColor
 *   na      -> null
 * Tuples (Pine's `[a, b] = f()`) are JS arrays.
 */

export interface PineColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A plain object used for property bags (e.g. `strategy.direction`). */
export interface PineObject {
  [key: string]: PineValue;
}

export type PineValue =
  | number
  | boolean
  | string
  | null
  | PineColor
  | PineValue[]
  | PineObject
  | PineCallable
  | PineBoundMethod
  | PineProperty;

/**
 * A value that is also callable and can carry methods.
 *
 * Pine exposes things like `strategy.opentrades` as an integer that
 * nevertheless supports `strategy.opentrades.entry_price(0)`. This type
 * models that: `value` is what the expression evaluates to, `methods` are the
 * extra accessors.
 */
export interface PineCallable {
  __callable: true;
  value: PineValue;
  methods: Record<string, (...args: PineValue[]) => PineValue>;
}

/** A method bound to its receiver, produced by member access on a callable. */
export interface PineBoundMethod {
  __boundMethod: true;
  fn: (...args: PineValue[]) => PineValue;
}

export function isCallable(value: unknown): value is PineCallable {
  return !!value && typeof value === "object" && !Array.isArray(value) && "__callable" in value;
}

/**
 * A namespace member that holds a live value (e.g. `strategy.position_size`)
 * and can be assigned to (e.g. `strategy.default_qty_type = ...`).
 */
export interface PineProperty {
  __property: true;
  get(): PineValue;
  set(value: PineValue): void;
}

export function isProperty(value: unknown): value is PineProperty {
  return !!value && typeof value === "object" && !Array.isArray(value) && "__property" in value;
}

export function isBoundMethod(value: unknown): value is PineBoundMethod {
  return !!value && typeof value === "object" && !Array.isArray(value) && "__boundMethod" in value;
}

/** Strip the callable wrapper, keeping the underlying value. */
export function unwrap(value: PineValue): PineValue {
  return isCallable(value) ? value.value : value;
}

export const NA: null = null;

export function isNA(value: PineValue): boolean {
  return value === null || value === undefined;
}

export function isNumber(value: PineValue): value is number {
  return typeof value === "number";
}

export function isTuple(value: PineValue): value is PineValue[] {
  return Array.isArray(value);
}

export function isColor(value: unknown): value is PineColor {
  return !!value && typeof value === "object" && !Array.isArray(value) && "r" in value;
}

/** Truthiness with Pine semantics: na is false. */
export function truthy(value: PineValue): boolean {
  const unwrapped = unwrap(value);
  if (unwrapped === null) return false;
  if (typeof unwrapped === "boolean") return unwrapped;
  if (typeof unwrapped === "number") return unwrapped !== 0 && !Number.isNaN(unwrapped);
  if (typeof unwrapped === "string") return unwrapped.length > 0;
  return true;
}

/** Numeric coercion; na propagates as null so `na + 1` stays na. */
export function toNumber(value: PineValue): number | null {
  const unwrapped = unwrap(value);
  if (unwrapped === null) return null;
  if (typeof unwrapped === "number") return Number.isFinite(unwrapped) ? unwrapped : null;
  if (typeof unwrapped === "boolean") return unwrapped ? 1 : 0;
  if (typeof unwrapped === "string") {
    const parsed = Number(unwrapped);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toBoolean(value: PineValue): boolean {
  return truthy(value);
}

export function toDisplayString(value: PineValue): string {
  const unwrapped = unwrap(value);
  if (unwrapped === null) return "na";
  if (typeof unwrapped === "number") {
    if (!Number.isFinite(unwrapped)) return "na";
    return Number.isInteger(unwrapped) ? String(unwrapped) : String(Number(unwrapped.toFixed(8)));
  }
  if (typeof unwrapped === "boolean") return unwrapped ? "true" : "false";
  if (typeof unwrapped === "string") return unwrapped;
  if (isColor(unwrapped)) return valueToCss(unwrapped);
  if (Array.isArray(unwrapped)) return `[${unwrapped.map(toDisplayString).join(", ")}]`;
  return String(unwrapped);
}

export function valueToCss(color: PineColor): string {
  const channel = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const alpha = Math.max(0, Math.min(1, color.a ?? 1));
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${alpha})`;
}

export function cssToColor(css: string): PineColor {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(css);
  if (!match) return { r: 128, g: 128, b: 128, a: 1 };
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
    a: match[4] === undefined ? 1 : Number(match[4]),
  };
}
