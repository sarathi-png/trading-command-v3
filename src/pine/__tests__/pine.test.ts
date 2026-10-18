/**
 * Pine runtime tests.
 *
 * Run with:  npm run test:pine   (compiles to output/ and runs node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { runPine, toBars, type BarData } from "../index";
import { EXAMPLES } from "../examples";

/** A deterministic series of bars: closes 1..N with a fixed range. */
function makeBars(count: number, start = 1): BarData[] {
  const bars: BarData[] = [];
  for (let i = 0; i < count; i++) {
    const close = start + i;
    bars.push({
      time: 1_700_000_000 + i * 300,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000 + i,
    });
  }
  return bars;
}

test("parses and evaluates a simple indicator", () => {
  const result = runPine(
    `
//@version=5
indicator("Test", overlay=true)
sma20 = ta.sma(close, 20)
plot(sma20, "SMA 20")
`,
    makeBars(30)
  );
  assert.equal(result.compileFailed, false);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(result.meta.title, "Test");
  assert.equal(result.plots.length, 1);
  assert.equal(result.plots[0].title, "SMA 20");
  // The first 19 bars have no average; bar 20 averages 1..20.
  const points = result.plots[0].points;
  assert.equal(points.length, 11); // 30 bars - 19 warm-up
  assert.equal(points[0].value, 10.5);
  assert.equal(points[points.length - 1].value, 20.5);
});

test("supports if/else, ternary and boolean operators", () => {
  const result = runPine(
    `
indicator("Logic")
state = close > 2 ? "above" : "below"
if close > 2
    label = "high"
else
    label = "low"
plot(close, "close")
plot(close > 2 ? 1 : 0, "flag")
`,
    makeBars(5)
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.plots.length, 2);
  assert.equal(result.plots[1].points[0].value, 0); // close = 1
  assert.equal(result.plots[1].points[2].value, 1); // close = 3
});

test("user functions receive parameters and return values", () => {
  const result = runPine(
    `
indicator("Functions")
f_double(int x) => x * 2
f_add(float a, float b) =>
    a + b
plot(f_double(5), "double")
plot(f_add(1.5, 2.5), "add")
`,
    makeBars(3)
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.plots[0].points[0].value, 10);
  assert.equal(result.plots[1].points[0].value, 4);
});

test("series history works for market series and globals", () => {
  const result = runPine(
    `
indicator("History")
prev = close[1]
var float last = 0.0
last := close
plot(prev, "previous close")
plot(last[1], "previous last")
`,
    makeBars(4)
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.plots[0].points[0].value, 1); // close[1] of the 2nd bar
  assert.equal(result.plots[1].points[0].value, 1); // last[1] = previous bar's close
});

test("crossover and crossunder are detected", () => {
  const bars: BarData[] = [
    { time: 1, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: 2, open: 10, high: 10, low: 10, close: 10, volume: 1 },
    { time: 3, open: 12, high: 12, low: 12, close: 12, volume: 1 },
  ];
  const result = runPine(
    `
indicator("Cross")
fast = ta.ema(close, 2)
slow = ta.ema(close, 3)
plot(ta.crossover(fast, slow) ? 1 : 0, "cross")
`,
    bars
  );
  assert.deepEqual(result.errors, []);
  const flags = result.plots[0].points.map((point) => point.value);
  assert.equal(flags[flags.length - 1], 1);
});

test("strategy entry and exit produce a trade and stats", () => {
  const bars: BarData[] = [];
  for (let i = 0; i < 10; i++) {
    const close = i < 5 ? 100 : 120; // +20 move after the 5th bar
    bars.push({ time: i, open: close, high: close + 1, low: close - 1, close, volume: 10 });
  }
  const result = runPine(
    `
strategy("Test strategy", overlay=true)
strategy.default_qty_type = strategy.fixed
strategy.default_qty_value = 1
if bar_index == 1
    strategy.entry("Long", strategy.long)
if bar_index == 4
    strategy.close("Long")
`,
    bars
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.trades.length, 1);
  const trade = result.trades[0];
  assert.equal(trade.direction, "long");
  assert.equal(trade.exitReason, "signal");
  assert.ok(trade.netProfit > 0);
  assert.equal(result.stats?.totalTrades, 1);
  assert.equal(result.stats?.winRate, 100);
});

test("strategy stop loss is honoured", () => {
  const bars: BarData[] = [];
  for (let i = 0; i < 8; i++) {
    const close = i < 4 ? 100 : 90;
    bars.push({ time: i, open: close, high: close + 1, low: close - 1, close, volume: 10 });
  }
  const result = runPine(
    `
strategy("Stop test")
strategy.default_qty_value = 1
if bar_index == 1
    strategy.entry("Long", strategy.long)
    strategy.exit("Stop", "Long", stop=95)
`,
    bars
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].exitReason, "stop");
  assert.ok(result.trades[0].netProfit < 0);
});

test("plotshape and alert produce events", () => {
  const result = runPine(
    `
indicator("Shapes")
plotshape(close > 3, title="up", style=shape.triangleup, location=location.abovebar)
alertcondition(close > 3, title="High", message="Price is high")
if close > 3
    alert("price high")
`,
    makeBars(5)
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.shapes.length, 2); // close = 4 and 5
  assert.equal(result.alerts.length, 2);
  assert.equal(result.alertConditions.length, 1);
  assert.equal(result.alertConditions[0].active, true);
});

test("input.* is collected and can be overridden", () => {
  const bars = makeBars(30);
  const first = runPine(
    `
indicator("Inputs")
length = input.int(20, "Length")
plot(ta.sma(close, length), "SMA")
`,
    bars
  );
  assert.deepEqual(first.errors, []);
  assert.equal(first.inputs.length, 1);
  assert.equal(first.inputs[0].title, "Length");
  assert.equal(first.inputs[0].defval, 20);
  assert.equal(first.plots[0].points.length, 11);

  const overridden = runPine(
    `
indicator("Inputs")
length = input.int(20, "Length")
plot(ta.sma(close, length), "SMA")
`,
    bars,
    { inputOverrides: { [first.inputs[0].id]: 5 } }
  );
  assert.equal(overridden.plots[0].points.length, 26);
});

test("syntax errors are reported without throwing", () => {
  const result = runPine("indicator(\"broken\"", makeBars(3));
  assert.equal(result.compileFailed, true);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test("unknown identifiers are reported", () => {
  const result = runPine(
    `
indicator("Bad")
plot(doesNotExist, "x")
`,
    makeBars(3)
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.message.includes("doesNotExist")));
});

test("math and ta helpers behave", () => {
  const result = runPine(
    `
indicator("Math")
plot(math.max(close, 100), "max")
plot(math.round(close * 1.5), "round")
plot(ta.highest(close, 3), "highest")
plot(ta.change(close, 1), "change")
`,
    makeBars(5)
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.plots[0].points[0].value, 100);
  assert.equal(result.plots[1].points[0].value, 2); // round(1.5)
  assert.equal(result.plots[2].points[0].value, 3); // highest of the last 3 closes
  assert.equal(result.plots[3].points[0].value, 1); // close - close[1]
});

test("a realistic multi-feature strategy runs end to end", () => {
  const source = `
//@version=5
strategy("Donchian breakout", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=10)
length = input.int(20, "Lookback")
useFilter = input.bool(true, "Use trend filter")
fast = ta.ema(close, 20)
slow = ta.ema(close, 50)
upper = ta.highest(high[1], length)
lower = ta.lowest(low[1], length)
longCondition = close > upper
shortCondition = close < lower
if longCondition
    strategy.entry("Long", strategy.long)
if shortCondition
    strategy.entry("Short", strategy.short)
if longCondition and useFilter and fast > slow
    plotshape(true, title="Long", style=shape.triangleup, location=location.belowbar)
plot(upper, "Upper")
plot(lower, "Lower")
`;
  const result = runPine(source, makeBars(120));
  assert.equal(result.compileFailed, false);
  assert.deepEqual(result.errors, []);
  assert.equal(result.plots.length, 2);
  assert.ok(result.inputs.length >= 2);
  assert.ok(result.stats);
});

test("toBars maps app candles", () => {
  const bars = toBars([
    { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
  ]);
  assert.equal(bars[0].high, 2);
  assert.equal(bars[0].close, 1.5);
});

test("every bundled example script runs", () => {
  for (const example of EXAMPLES) {
    const result = runPine(example.source, makeBars(200));
    assert.equal(
      result.compileFailed,
      false,
      `${example.name} failed to compile: ${result.errors.map((error) => error.message).join("; ")}`
    );
    assert.deepEqual(
      result.errors,
      [],
      `${example.name} reported errors: ${result.errors.map((error) => error.message).join("; ")}`
    );
    assert.equal(result.ok, true, `${example.name} did not run`);
    assert.ok(result.plots.length > 0, `${example.name} produced no plots`);
  }
});

test("tuple destructuring binds a multi-value function", () => {
  const result = runPine(
    `
//@version=5
indicator("Tuple", overlay=false)
[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)
plot(macdLine, "MACD")
plot(signalLine, "Signal")
plot(histLine, "Histogram", style=plot.style_histogram)
`,
    makeBars(120)
  );
  assert.equal(result.compileFailed, false);
  assert.deepEqual(result.errors, []);
  assert.equal(result.plots.length, 3);
});

test("a named argument may be a keyword, as in color=color.teal", () => {
  const result = runPine(
    `
//@version=5
indicator("Named", overlay=true)
plot(close, "Close", color=color.teal, linewidth=2)
plotshape(close > open, title="Up", style=shape.triangleup, location=location.belowbar, color=color.lime)
`,
    makeBars(30)
  );
  assert.equal(result.compileFailed, false);
  assert.deepEqual(result.errors, []);
  assert.equal(result.plots.length, 1);
  assert.equal(result.plots[0].color, "rgba(0, 128, 128, 1)");
});

test("the line style constants use Pine's names", () => {
  const result = runPine(
    `
//@version=5
indicator("Styles", overlay=true)
hline(100, "Level", color=color.red, linestyle=hline.style_dotted)
plot(close, "Close", color=color.blue, style=plot.style_line)
`,
    makeBars(30)
  );
  assert.equal(result.compileFailed, false);
  assert.deepEqual(result.errors, []);
});
