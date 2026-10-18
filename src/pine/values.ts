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

/**
 * A Pine array: `array.new<float>()`.
 *
 * Arrays are reference values, so `zoneList.get(i).top := x` mutates the
 * object inside the array — which is what the user's S/R zone code relies on.
 */
export interface PineArray {
  __array: true;
  /** The declared element type, e.g. "SRZone". */
  typeName: string | null;
  items: PineValue[];
}

/**
 * An instance of a user-declared `type`, e.g. `SRZone.new(top = 1)`.
 * Fields are stored directly on the object so they can be mutated in place.
 */
export interface PineUserObject extends PineObject {
  __userType: string;
}

/**
 * A drawing object (`box.new`, `label.new`, `table.new`). The runtime keeps
 * them as live objects so the script can mutate them, and reports them to the
 * app so the chart can draw them.
 */
export interface PineDrawing {
  __drawing: "box" | "label" | "table";
  id: number;
  deleted: boolean;
  [key: string]: unknown;
}

export type PineValue =
  | number
  | boolean
  | string
  | null
  | PineColor
  | PineValue[]
  | PineObject
  | PineArray
  | PineUserObject
  | PineDrawing
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
/**
 * The slice of the host a live property needs. Properties such as
 * `barstate.islast` are values, not functions, so their getter is called
 * with the host rather than with arguments.
 */
export interface PinePropertyHost {
  barIndex(): number;
  lastBarIndex(): number;
  bar(): { time: number; open: number; high: number; low: number; close: number; volume: number };
}

export interface PineProperty {
  __property: true;
  get(host?: PinePropertyHost): PineValue;
  set(value: PineValue, host?: PinePropertyHost): void;
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

/** `na(x)` — the value, or the fallback when it is na. */
export function nz(value: PineValue, fallback: PineValue = 0): PineValue {
  const unwrapped = unwrap(value);
  if (unwrapped === null || unwrapped === undefined) return fallback;
  if (typeof unwrapped === "number" && !Number.isFinite(unwrapped)) return fallback;
  return unwrapped;
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

export function isArray(value: unknown): value is PineArray {
  return !!value && typeof value === "object" && !Array.isArray(value) && "__array" in value;
}

export function isUserObject(value: unknown): value is PineUserObject {
  return !!value && typeof value === "object" && !Array.isArray(value) && "__userType" in value;
}

export function isDrawing(value: unknown): value is PineDrawing {
  return !!value && typeof value === "object" && !Array.isArray(value) && "__drawing" in value;
}

/** A fresh Pine array. */
export function newArray(typeName: string | null = null): PineArray {
  return { __array: true, typeName, items: [] };
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
