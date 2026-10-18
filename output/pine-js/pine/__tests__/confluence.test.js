"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Regression test for the "Crypto Confluence Signals [8x]" indicator.
 *
 * This is the script the mobile app was built for. It is a large v6 script
 * that uses most of the Pine language: user types, arrays of objects,
 * drawing objects (boxes, labels, a table), anchored VWAP, pivots, a time
 * window filter, an input group and 39 inputs.
 *
 * If the runtime cannot run this script, the app cannot run the user's
 * script — so the whole file is kept verbatim and asserted on.
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_1 = require("../index");
const confluence_1 = require("../scripts/confluence");
/** A deterministic price series with trends, so pivots and zones appear. */
function makeBars(count) {
    let seed = 7;
    const next = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    let price = 100;
    return Array.from({ length: count }, (_, index) => {
        const open = price;
        const close = open + (next() - 0.5) * 2 + Math.sin(index / 9) * 1.4;
        const high = Math.max(open, close) + next() * 0.8;
        const low = Math.min(open, close) - next() * 0.8;
        price = close;
        return {
            time: 1_700_000_000 + index * 900,
            open,
            high,
            low,
            close,
            volume: 100 + next() * 500,
        };
    });
}
const BARS = makeBars(300);
(0, node_test_1.test)("the confluence script compiles", () => {
    const result = (0, index_1.runPine)(confluence_1.CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });
    strict_1.default.equal(result.compileFailed, false, "the script must parse");
    strict_1.default.deepEqual(result.errors, [], "the script must run without runtime errors");
    strict_1.default.equal(result.ok, true);
});
(0, node_test_1.test)("the confluence script exposes its inputs", () => {
    const result = (0, index_1.runPine)(confluence_1.CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });
    strict_1.default.equal(result.inputs.length, 39);
    strict_1.default.ok(result.inputs.some((input) => input.title === "EMA Length"));
    strict_1.default.ok(result.inputs.some((input) => input.title === "Show internals (lines)"));
});
(0, node_test_1.test)("the confluence script draws its signals", () => {
    const result = (0, index_1.runPine)(confluence_1.CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });
    const labels = result.drawings.filter((drawing) => drawing.kind === "label");
    strict_1.default.ok(labels.length > 0, "the script labels its signals");
    strict_1.default.ok(labels.some((label) => /BUY|SELL/.test(label.text)), "at least one BUY or SELL label is drawn");
    strict_1.default.ok(labels.every((label) => label.time !== null && label.price !== null), "every label is anchored to a bar and a price");
    const boxes = result.drawings.filter((drawing) => drawing.kind === "box");
    strict_1.default.ok(boxes.length > 0, "the script draws its stop/target zones");
    const tables = result.drawings.filter((drawing) => drawing.kind === "table");
    strict_1.default.equal(tables.length, 1, "the script keeps one info table");
    strict_1.default.ok(tables[0].cells.length > 0, "the info table has content");
    strict_1.default.ok(tables[0].cells.some((cell) => cell.text === "CONF"));
});
(0, node_test_1.test)("the confluence script plots its internals on request", () => {
    const plain = (0, index_1.runPine)(confluence_1.CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });
    strict_1.default.equal(plain.plots.length, 0, "the internal lines are hidden by default");
    const showInternals = plain.inputs.find((input) => /internals/i.test(input.title));
    strict_1.default.ok(showInternals, "the script has a toggle for the internal lines");
    const result = (0, index_1.runPine)(confluence_1.CONFLUENCE_SOURCE, BARS, {
        symbol: "BTCUSD",
        timeframe: "15m",
        inputOverrides: { [showInternals.id]: true },
    });
    strict_1.default.deepEqual(result.plots.map((plot) => plot.title).sort(), [
        "BB Basis",
        "BB Lower",
        "BB Upper",
        "Chandelier Long",
        "Chandelier Short",
        "Donchian Mid",
        "EMA100",
        "SuperTrend",
        "VWAP",
    ]);
    strict_1.default.ok(result.plots.every((plot) => plot.points.length > 0));
});
(0, node_test_1.test)("the confluence script registers its alert conditions", () => {
    const result = (0, index_1.runPine)(confluence_1.CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });
    strict_1.default.deepEqual(result.alertConditions.map((condition) => condition.title), ["Confluence BUY", "Confluence SELL"]);
});
