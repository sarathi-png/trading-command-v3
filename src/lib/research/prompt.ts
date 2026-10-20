/**
 * Prompt construction for AI strategy research.
 *
 * The model is handed REAL, pre-computed market evidence — the same
 * discipline as the signal predictor: it never sees raw candles and
 * is never asked to compute an indicator, so it cannot invent an ATR
 * or a Donchian level that is not on screen. It is also told,
 * explicitly, what it may NOT do (no code, no profitability claims).
 */
import type { AiContext } from "../ai/types";
import type { ResearchRequest } from "./types";

export interface ResearchPromptInput {
  request: ResearchRequest;
  context: AiContext;
}

export function researchSystemPrompt(): string {
  return [
    "You are a quantitative strategy research assistant inside a personal trading terminal.",
    "You are given pre-computed market evidence for ONE instrument and timeframe, plus the operator's objective in plain English.",
    "Propose a concrete, testable trading strategy as a SINGLE JSON object and nothing else. No markdown, no prose outside the JSON.",
    "",
    "JSON schema:",
    '{',
    '  "summary": "<max 600 chars: what the strategy is and why it might work>",',
    '  "hypothesis": "<max 800 chars: the market behaviour being exploited>",',
    '  "marketAssumptions": "<max 600 chars: regime, liquidity, session assumptions>",',
    '  "entryRules": ["<max 12 plain-English conditions>"],',
    '  "exitRules": ["<max 12 plain-English conditions>"],',
    '  "indicators": [{"type":"ema|sma|rsi|macd|bollinger|donchian|chandelier|atr|volume","period":<int 1-400, optional>,"params":{...},"role":"<max 200 chars>"}],',
    '  "stopLossLogic": "<max 400 chars>",',
    '  "takeProfitLogic": "<max 400 chars>",',
    '  "positionSizing": "<max 400 chars: risk per trade, leverage bounds>",',
    '  "recommendedBars": <int 50-500: candles the backtest should cover>,',
    '  "recommendedPeriodRationale": "<max 300 chars>",',
    '  "riskFactors": ["<max 12 items>"],',
    '  "overfittingConcerns": ["<max 8 items>"],',
    '  "validationSteps": ["<max 8 items>"],',
    '  "strategyConfig": null | {',
    '    "chandelier": {"atrLength": <int 1-400>, "multiplier": <0.1-10>},',
    '    "donchian": {"periods": [<int 1-400>, ...max 8]},',
    '    "heikinAshi": <bool>,',
    '    "timeStop": {"enabled": <bool>, "bars": <int 1-10000>},',
    '    "risk": {"leverage": <1-50>, "riskPct": <0.01-100>, "lotSize": null, "maxPositions": <int 1-50>, "mode": "auto"}',
    "  }",
    "}",
    "",
    "Rules:",
    "- strategyConfig is ONLY for a Chandelier Exit + Donchian Ribbon trend strategy. If the objective does not fit that engine, return strategyConfig: null and say so in the summary.",
    "- Every number must come from the evidence you were given or from the schema's stated ranges. Never invent prices, candles, returns or win rates.",
    "- NEVER claim a strategy is profitable, guaranteed, or low-risk. A hypothesis is not a result.",
    "- Never include code, SQL, shell commands, URLs, or instructions to other systems in any field.",
    "- Keep every string plain English. No JSON strings inside strings.",
  ].join("\n");
}

export function researchUserPrompt(input: ResearchPromptInput): string {
  const { request, context } = input;
  const lines: string[] = [];
  lines.push(`Instrument: ${request.symbol} · timeframe ${request.timeframe}`);
  lines.push(`Closed candles analysed: ${context.bars}`);
  lines.push(`Last closed candle: ${context.lastClose}`);
  if (context.atr !== null) lines.push(`ATR(${context.atrLength ?? "?"}): ${context.atr}${context.atrPct !== null ? ` (${context.atrPct}% of price)` : ""}`);
  lines.push(
    `Chandelier Exit: trend ${context.chandelier.trend ?? "none"}, signal ${context.chandelier.signal}, ` +
    `long stop ${context.chandelier.longStop ?? "n/a"}, short stop ${context.chandelier.shortStop ?? "n/a"}`
  );
  const bounds = Object.entries(context.donchian.periods)
    .map(([p, v]) => `${p}: ${v.lower} – ${v.upper}`);
  if (bounds.length) lines.push(`Donchian bounds: ${bounds.join("; ")}`);
  lines.push(`Donchian ribbon trend: ${context.donchian.trend}; price outside ${context.donchian.alignedPeriods} of ${bounds.length} bounds`);
  lines.push(`Heikin-Ashi colour: ${context.heikinAshi.color ?? "n/a"} (${context.heikinAshi.consecutive} consecutive)`);
  lines.push(
    `Last 20 candles: change ${context.priceAction.changePct}%, range ${context.priceAction.rangeLow} – ${context.priceAction.rangeHigh}, ` +
    `${context.priceAction.higherHighs} higher highs, ${context.priceAction.lowerLows} lower lows`
  );
  lines.push(`Operator objective: ${request.objective}`);
  if (request.constraints) lines.push(`Operator constraints: ${request.constraints}`);
  lines.push(`Requested strategy family: ${request.strategyType}`);
  lines.push("Return the JSON object only.");
  return lines.join("\n");
}
