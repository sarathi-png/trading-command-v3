import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAiContext } from "./context";
import { ruleVerdict } from "./rules";
import { decisionSummary } from "./decision";
import type { AiPrediction } from "./types";
const context = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: Array.from({ length: 260 }, (_, i) => ({ time: i * 300, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 100 })) });
const direction = ruleVerdict(context).direction;
const prediction = (patch: Partial<AiPrediction> = {}) => ({ context, provider: "openrouter", degraded: false, direction, ...patch }) as AiPrediction;
describe("honest strategy and AI comparison", () => {
  it("compares decisions on the same chart snapshot", () => assert.deepEqual(decisionSummary(prediction()), { strategy: direction, ai: direction, result: "MATCH" }));
  it("shows disagreement without treating it as trade approval", () => {
    const other = direction === "LONG" ? "SHORT" : "LONG";
    assert.equal(decisionSummary(prediction({ direction: other })).result, "DISAGREE");
  });
  it("never counts a rule-only fallback as an independent AI match", () => {
    assert.deepEqual(decisionSummary(prediction({ provider: "rules", degraded: true })), { strategy: direction, ai: null, result: "NOT COMPARED" });
  });
  it("compares the original model decision, not the forced-neutral safety result", () => {
    const other = direction === "LONG" ? "SHORT" : "LONG";
    const summary = decisionSummary(prediction({ direction: "NEUTRAL", modelDecision: { direction: other, rationale: "Model proposal", confidence: 60 }, notice: "Technical safety veto" }));
    assert.equal(summary.ai, other);
    assert.equal(summary.result, "DISAGREE");
  });
  it("does not invent a model vote for legacy vetoed rows", () => assert.equal(decisionSummary(prediction({ notice: "Technical safety veto: no directional call" })).ai, null));
  it("does not compare a degraded external response either", () => assert.equal(decisionSummary(prediction({ degraded: true })).ai, null));
});
