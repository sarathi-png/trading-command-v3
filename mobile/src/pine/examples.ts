/**
 * Pine scripts that ship with the app.
 *
 * They double as documentation of what the runtime supports: inputs, the
 * ta.* library, plots, plotshapes, alerts and the strategy simulator.
 */
import { CONFLUENCE_SOURCE } from "./scripts/confluence";

export interface PineExample {
  name: string;
  source: string;
}

export const EXAMPLES: PineExample[] = [
  {
    name: "Crypto Confluence Signals [8x]",
    source: CONFLUENCE_SOURCE,
  },
  {
    name: "EMA Ribbon",
    source: `//@version=5
indicator("EMA Ribbon", overlay=true)

fastLength = input.int(21, "Fast EMA")
slowLength = input.int(55, "Slow EMA")
source = input.source(close, "Source")

fast = ta.ema(source, fastLength)
slow = ta.ema(source, slowLength)
trend = fast > slow ? "BULLISH" : "BEARISH"

plot(fast, "Fast EMA", color=color.teal, linewidth=2)
plot(slow, "Slow EMA", color=color.red, linewidth=2)
plot(fast - slow, "Ribbon", color=color.orange, linewidth=1)

plotshape(
     ta.crossover(fast, slow),
     title="Golden cross",
     style=shape.triangleup,
     location=location.belowbar,
     color=color.lime,
     text="GOLDEN CROSS")

plotshape(
     ta.crossunder(fast, slow),
     title="Death cross",
     style=shape.triangledown,
     location=location.abovebar,
     color=color.red,
     text="DEATH CROSS")

alertcondition(
     ta.crossover(fast, slow),
     title="Bullish crossover",
     message="Fast EMA crossed above the slow EMA")
`,
  },
  {
    name: "Donchian Breakout (strategy)",
    source: `//@version=5
strategy("Donchian Breakout", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=10)

length = input.int(20, "Channel length")
useTrendFilter = input.bool(true, "Trend filter")
atrLength = input.int(14, "ATR length")
atrMult = input.float(2.0, "ATR stop multiple")

upper = ta.highest(high[1], length)
lower = ta.lowest(low[1], length)
longStop = close - ta.atr(atrLength) * atrMult
shortStop = close + ta.atr(atrLength) * atrMult

longCondition = close > upper
shortCondition = close < lower
trendUp = ta.ema(close, 50) > ta.ema(close, 200)

if longCondition and (not useTrendFilter or trendUp)
    strategy.entry("Long", strategy.long)
    strategy.exit("Long stop", "Long", stop=longStop)

if shortCondition and (not useTrendFilter or not trendUp)
    strategy.entry("Short", strategy.short)
    strategy.exit("Short stop", "Short", stop=shortStop)

plot(upper, "Upper channel", color=color.teal, linewidth=1)
plot(lower, "Lower channel", color=color.red, linewidth=1)

plotshape(longCondition, title="Long signal", style=shape.triangleup, location=location.belowbar, color=color.lime)
plotshape(shortCondition, title="Short signal", style=shape.triangledown, location=location.abovebar, color=color.red)
`,
  },
  {
    name: "RSI + MACD",
    source: `//@version=5
indicator("RSI and MACD", overlay=false)

rsiLength = input.int(14, "RSI length")
overbought = input.float(70, "Overbought")
oversold = input.float(30, "Oversold")

rsi = ta.rsi(close, rsiLength)
[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)

plot(rsi, "RSI", color=color.purple, linewidth=2)
hline(overbought, "Overbought", color=color.red, linestyle=hline.style_dotted)
hline(oversold, "Oversold", color=color.lime, linestyle=hline.style_dotted)
plot(macdLine, "MACD", color=color.blue)
plot(signalLine, "Signal", color=color.orange)
plot(histLine, "Histogram", color=color.gray, style=plot.style_histogram)

plotshape(
     ta.crossunder(rsi, oversold),
     title="RSI oversold",
     style=shape.circle,
     location=location.bottom,
     color=color.lime)

alertcondition(
     ta.crossunder(rsi, oversold),
     title="RSI oversold",
     message="RSI dropped below the oversold level")
`,
  },
  {
    name: "Supertrend",
    source: `//@version=5
indicator("Supertrend", overlay=true)

factor = input.float(3.0, "Factor")
period = input.int(10, "ATR period")

[st, direction] = ta.supertrend(factor, period)

plot(st, "Supertrend", color=direction == 1 ? color.teal : color.red, linewidth=2)
plotshape(
     direction == 1 and direction[1] == -1,
     title="Flip long",
     style=shape.triangleup,
     location=location.belowbar,
     color=color.lime)

plotshape(
     direction == -1 and direction[1] == 1,
     title="Flip short",
     style=shape.triangledown,
     location=location.abovebar,
     color=color.red)
`,
  },
];
