"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NA = void 0;
exports.isCallable = isCallable;
exports.isProperty = isProperty;
exports.isBoundMethod = isBoundMethod;
exports.unwrap = unwrap;
exports.isNA = isNA;
exports.nz = nz;
exports.isNumber = isNumber;
exports.isTuple = isTuple;
exports.isColor = isColor;
exports.isArray = isArray;
exports.isUserObject = isUserObject;
exports.isDrawing = isDrawing;
exports.newArray = newArray;
exports.truthy = truthy;
exports.toNumber = toNumber;
exports.toBoolean = toBoolean;
exports.toDisplayString = toDisplayString;
exports.valueToCss = valueToCss;
exports.cssToColor = cssToColor;
function isCallable(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && "__callable" in value;
}
function isProperty(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && "__property" in value;
}
function isBoundMethod(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && "__boundMethod" in value;
}
/** Strip the callable wrapper, keeping the underlying value. */
function unwrap(value) {
    return isCallable(value) ? value.value : value;
}
exports.NA = null;
function isNA(value) {
    return value === null || value === undefined;
}
/** `na(x)` — the value, or the fallback when it is na. */
function nz(value, fallback = 0) {
    const unwrapped = unwrap(value);
    if (unwrapped === null || unwrapped === undefined)
        return fallback;
    if (typeof unwrapped === "number" && !Number.isFinite(unwrapped))
        return fallback;
    return unwrapped;
}
function isNumber(value) {
    return typeof value === "number";
}
function isTuple(value) {
    return Array.isArray(value);
}
function isColor(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && "r" in value;
}
function isArray(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && "__array" in value;
}
function isUserObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && "__userType" in value;
}
function isDrawing(value) {
    return !!value && typeof value === "object" && !Array.isArray(value) && "__drawing" in value;
}
/** A fresh Pine array. */
function newArray(typeName = null) {
    return { __array: true, typeName, items: [] };
}
/** Truthiness with Pine semantics: na is false. */
function truthy(value) {
    const unwrapped = unwrap(value);
    if (unwrapped === null)
        return false;
    if (typeof unwrapped === "boolean")
        return unwrapped;
    if (typeof unwrapped === "number")
        return unwrapped !== 0 && !Number.isNaN(unwrapped);
    if (typeof unwrapped === "string")
        return unwrapped.length > 0;
    return true;
}
/** Numeric coercion; na propagates as null so `na + 1` stays na. */
function toNumber(value) {
    const unwrapped = unwrap(value);
    if (unwrapped === null)
        return null;
    if (typeof unwrapped === "number")
        return Number.isFinite(unwrapped) ? unwrapped : null;
    if (typeof unwrapped === "boolean")
        return unwrapped ? 1 : 0;
    if (typeof unwrapped === "string") {
        const parsed = Number(unwrapped);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function toBoolean(value) {
    return truthy(value);
}
function toDisplayString(value) {
    const unwrapped = unwrap(value);
    if (unwrapped === null)
        return "na";
    if (typeof unwrapped === "number") {
        if (!Number.isFinite(unwrapped))
            return "na";
        return Number.isInteger(unwrapped) ? String(unwrapped) : String(Number(unwrapped.toFixed(8)));
    }
    if (typeof unwrapped === "boolean")
        return unwrapped ? "true" : "false";
    if (typeof unwrapped === "string")
        return unwrapped;
    if (isColor(unwrapped))
        return valueToCss(unwrapped);
    if (Array.isArray(unwrapped))
        return `[${unwrapped.map(toDisplayString).join(", ")}]`;
    return String(unwrapped);
}
function valueToCss(color) {
    const channel = (v) => Math.max(0, Math.min(255, Math.round(v)));
    const alpha = Math.max(0, Math.min(1, color.a ?? 1));
    return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${alpha})`;
}
function cssToColor(css) {
    const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/.exec(css);
    if (!match)
        return { r: 128, g: 128, b: 128, a: 1 };
    return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] === undefined ? 1 : Number(match[4]),
    };
}
