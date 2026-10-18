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
import { test } from "node:test";
import assert from "node:assert/strict";

import { runPine, type BarData, type PineLabelDrawing, type PineTableDrawing } from "../index";
import { CONFLUENCE_SOURCE } from "../scripts/confluence";

/** A deterministic price series with trends, so pivots and zones appear. */
function makeBars(count: number): BarData[] {
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

test("the confluence script compiles", () => {
  const result = runPine(CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });
  assert.equal(result.compileFailed, false, "the script must parse");
  assert.deepEqual(result.errors, [], "the script must run without runtime errors");
  assert.equal(result.ok, true);
});

test("the confluence script exposes its inputs", () => {
  const result = runPine(CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });
  assert.equal(result.inputs.length, 39);
  assert.ok(result.inputs.some((input) => input.title === "EMA Length"));
  assert.ok(result.inputs.some((input) => input.title === "Show internals (lines)"));
});

test("the confluence script draws its signals", () => {
  const result = runPine(CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });

  const labels = result.drawings.filter(
    (drawing): drawing is PineLabelDrawing => drawing.kind === "label"
  );
  assert.ok(labels.length > 0, "the script labels its signals");
  assert.ok(
    labels.some((label) => /BUY|SELL/.test(label.text)),
    "at least one BUY or SELL label is drawn"
  );
  assert.ok(
    labels.every((label) => label.time !== null && label.price !== null),
    "every label is anchored to a bar and a price"
  );

  const boxes = result.drawings.filter((drawing) => drawing.kind === "box");
  assert.ok(boxes.length > 0, "the script draws its stop/target zones");

  const tables = result.drawings.filter(
    (drawing): drawing is PineTableDrawing => drawing.kind === "table"
  );
  assert.equal(tables.length, 1, "the script keeps one info table");
  assert.ok(tables[0].cells.length > 0, "the info table has content");
  assert.ok(tables[0].cells.some((cell) => cell.text === "CONF"));
});

test("the confluence script plots its internals on request", () => {
  const plain = runPine(CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });
  assert.equal(plain.plots.length, 0, "the internal lines are hidden by default");

  const showInternals = plain.inputs.find((input) => /internals/i.test(input.title));
  assert.ok(showInternals, "the script has a toggle for the internal lines");

  const result = runPine(CONFLUENCE_SOURCE, BARS, {
    symbol: "BTCUSD",
    timeframe: "15m",
    inputOverrides: { [showInternals.id]: true },
  });
  assert.deepEqual(
    result.plots.map((plot) => plot.title).sort(),
    [
      "BB Basis",
      "BB Lower",
      "BB Upper",
      "Chandelier Long",
      "Chandelier Short",
      "Donchian Mid",
      "EMA100",
      "SuperTrend",
      "VWAP",
    ]
  );
  assert.ok(result.plots.every((plot) => plot.points.length > 0));
});

test("the confluence script registers its alert conditions", () => {
  const result = runPine(CONFLUENCE_SOURCE, BARS, { symbol: "BTCUSD", timeframe: "15m" });
  assert.deepEqual(
    result.alertConditions.map((condition) => condition.title),
    ["Confluence BUY", "Confluence SELL"]
  );
});
