import { ruleVerdict } from "./rules";
import type { AiDirection, AiPrediction } from "./types";

/** Compare the model with the deterministic strategy on the exact same snapshot. */
export function decisionSummary(prediction: AiPrediction): {
  strategy: AiDirection; ai: AiDirection | null; result: "MATCH" | "DISAGREE" | "NOT COMPARED";
} {
  const strategy = ruleVerdict(prediction.context).direction;
  const legacyVeto = !prediction.modelDecision && /technical.*veto|published call was reduced/i.test(prediction.notice ?? "");
  const ai = prediction.provider !== "rules" && !prediction.degraded && !legacyVeto
    ? prediction.modelDecision?.direction ?? prediction.direction : null;
  return { strategy, ai, result: ai === null ? "NOT COMPARED" : ai === strategy ? "MATCH" : "DISAGREE" };
}
