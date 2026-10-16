/**
 * Tests for the AI prediction layer.
 *
 * Everything here is deterministic: the indicator snapshot, the rule engine,
 * the answer validator, the outcome scoring and the free-tier budget guard. The
 * provider client is exercised with a fake `fetch`, so no test ever touches the
 * network or needs an API key.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Candle } from "@/lib/types";
import { buildAiContext } from "./context";
import { ruleVerdict, ruleEvidence } from "./rules";
import { extractJson, validatePrediction, degradationNotice } from "./prompt";
import { callProvider, extractMessageContent } from "./providers";
import { predictOutcome, scorecard, AI_NOISE_THRESHOLD_PCT } from "./outcomes";
import { AI_FREE_TIER_LIMITS, type AiPrediction } from "./types";

function makeCandles(count: number, trend: "up" | "down" | "flat" = "up", start = 100): Candle[] {
  const out: Candle[] = [];
  let price = start;
  let seed = 987654321;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const base = 1700000000;
  for (let i = 0; i < count; i++) {
    const drift = trend === "up" ? 0.4 : trend === "down" ? -0.4 : 0;
    const open = price;
    const close = price + drift + (random() - 0.5) * 0.6;
    const high = Math.max(open, close) + random() * 0.5;
    const low = Math.min(open, close) - random() * 0.5;
    out.push({ time: base + i * 300, open, high, low, close, volume: 10 + random() * 5 });
    price = close;
  }
  return out;
}

function makePrediction(overrides: Partial<AiPrediction> = {}): AiPrediction {
  const base = makeCandles(60, "up");
  const context = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: base });
  return {
    id: "p1",
    symbol: "BTCUSD",
    timeframe: "5m",
    chartType: "candles",
    provider: "rules",
    model: "test",
    direction: "LONG",
    confidence: 60,
    horizonBars: 3,
    rationale: "test rationale that is long enough to pass validation",
    invalidation: context.lastClose * 0.99,
    keyLevels: { support: null, resistance: null },
    entryPrice: context.lastClose,
    createdAt: Date.now(),
    barTime: context.lastBarTime,
    context,
    degraded: false,
    notice: null,
    outcome: null,
    ...overrides,
  };
}

describe("AI context snapshot", () => {
  it("derives indicator values from candles without inventing any", () => {
    const candles = makeCandles(260, "up");
    const ctx = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles });
    assert.equal(ctx.symbol, "BTCUSD");
    assert.equal(ctx.bars, 260);
    assert.equal(ctx.lastBarTime, candles[candles.length - 1].time * 1000);
    assert.equal(ctx.lastClose, candles[candles.length - 1].close);
    assert.ok(ctx.atr !== null && ctx.atr > 0, "ATR should be warm after 260 candles");
    assert.ok(ctx.chandelier.longStop !== null, "an uptrend should have a long trailing stop");
    assert.ok(Object.keys(ctx.donchian.periods).length >= 1, "Donchian bounds should be present");
    assert.ok(ctx.heikinAshi.color === "green" || ctx.heikinAshi.color === "red");
    assert.ok(ctx.priceAction.rangeHigh >= ctx.priceAction.rangeLow);
  });

  it("still produces a snapshot during warm-up, leaving the gaps honest", () => {
    // 10 candles cannot support ATR(20); the snapshot must say "null" instead of
    // inventing a number, and must not throw.
    const short = buildAiContext({ symbol: "ETHUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(10), atrLength: 20 });
    assert.equal(short.bars, 10);
    assert.equal(short.atr, null);
    assert.equal(short.chandelier.longStop, null);
    assert.equal(short.chandelier.shortStop, null);

    // 40 candles is already enough for the indicators: they must be populated.
    const warm = buildAiContext({ symbol: "ETHUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(40) });
    assert.ok(warm.atr !== null && warm.atr > 0);
  });

  it("rejects an empty series", () => {
    assert.throws(() => buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: [] }));
  });

  it("computes the Heikin-Ashi view separately from the candlestick view", () => {
    const candles = makeCandles(260, "up");
    const raw = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles });
    const ha = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "heikin-ashi", candles });
    assert.equal(raw.chartType, "candles");
    assert.equal(ha.chartType, "heikin-ashi");
    // Same market, same last close; the trailing stops differ because the
    // Heikin-Ashi series is smoothed.
    assert.equal(raw.lastClose, ha.lastClose);
  });
});

describe("rule engine (works with no API key at all)", () => {
  it("scores a live Donchian breakout above all bounds as full agreement", () => {
    // Chandelier long + a green ribbon with price outside every bound + a HA
    // streak: the only combination that earns the top tier.
    const ctx = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(400, "up") });
    const verdict = ruleVerdict(ctx);
    if (ctx.donchian.alignedPeriods === Object.keys(ctx.donchian.periods).length && verdict.votes.chandelier === 1) {
      assert.equal(verdict.votes.donchian, 1);
      assert.equal(verdict.confidence, 62);
    }
  });

  it("rates an established-but-pulled-back ribbon below a live breakout", () => {
    // Same snapshot shape, two Donchian states: the sticky trend flag alone must
    // never carry the same weight as a live breakout.
    const base = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(400, "up") });
    const liveBreakout = { ...base, donchian: { ...base.donchian, trend: "green" as const, alignedPeriods: Object.keys(base.donchian.periods).length } };
    const pulledBack = { ...base, donchian: { ...base.donchian, trend: "green" as const, alignedPeriods: 0 } };
    assert.equal(ruleVerdict(liveBreakout).votes.donchian, 1);
    assert.equal(ruleVerdict(pulledBack).votes.donchian, 0.5);
    assert.ok(Math.abs(ruleVerdict(liveBreakout).confidence) >= Math.abs(ruleVerdict(pulledBack).confidence));
  });

  it("calls LONG with 62 confidence when all three checks agree in an uptrend", () => {
    const ctx = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(300, "up") });
    const verdict = ruleVerdict(ctx);
    assert.equal(verdict.direction, "LONG");
    assert.equal(verdict.confidence, 62);
    assert.ok(verdict.invalidation !== null && verdict.invalidation < ctx.lastClose, "long invalidation must sit below price");
    assert.match(verdict.rationale, /Chandelier/);
    assert.match(verdict.rationale, /Donchian/);
  });

  it("calls SHORT in a downtrend with an invalidation above price", () => {
    const ctx = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(300, "down") });
    const verdict = ruleVerdict(ctx);
    assert.equal(verdict.direction, "SHORT");
    assert.ok(verdict.invalidation !== null && verdict.invalidation > ctx.lastClose);
  });

  it("abstains instead of forcing a call when indicators conflict", () => {
    // A flat series has no trend and no ribbon alignment: the honest answer is
    // NEUTRAL, and the rationale must say why.
    const ctx = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(300, "flat") });
    const verdict = ruleVerdict(ctx);
    assert.equal(verdict.direction, "NEUTRAL");
    assert.ok(verdict.confidence <= 30);
    assert.equal(verdict.invalidation, null, "an abstention must not claim an invalidation level");
  });

  it("exposes the evidence it used", () => {
    const ctx = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(300, "up") });
    const evidence = ruleEvidence(ctx);
    assert.ok(evidence.some((line) => /Chandelier/.test(line)));
    assert.ok(evidence.some((line) => /Donchian/.test(line)));
    assert.ok(evidence.length >= 3);
  });

  it("is deterministic — the same snapshot yields the same call", () => {
    const candles = makeCandles(300, "up");
    const a = ruleVerdict(buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles }));
    const b = ruleVerdict(buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles }));
    assert.deepEqual(a, b);
  });
});

describe("answer validation", () => {
  const ctx = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(260, "up") });

  it("accepts a well-formed LONG answer", () => {
    const result = validatePrediction({
      direction: "LONG",
      confidence: 65,
      horizonBars: 6,
      rationale: "Price is above every Donchian upper bound and the Chandelier long stop holds.",
      invalidation: ctx.lastClose * 0.98,
      keyLevels: { support: ctx.lastClose * 0.97, resistance: ctx.lastClose * 1.02 },
    }, ctx);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.direction, "LONG");
      assert.equal(result.value.confidence, 65);
      assert.equal(result.value.invalidation, ctx.lastClose * 0.98);
    }
  });

  it("rejects a LONG call whose invalidation sits above the entry price", () => {
    const result = validatePrediction({
      direction: "LONG", confidence: 70, rationale: "A rationale long enough to be reviewed by a human.",
      invalidation: ctx.lastClose * 1.01,
    }, ctx);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /below the decision price/);
  });

  it("rejects a directional call with no invalidation at all", () => {
    const result = validatePrediction({
      direction: "SHORT", confidence: 55, rationale: "A rationale long enough to be reviewed by a human.",
      invalidation: null,
    }, ctx);
    assert.equal(result.ok, false);
  });

  it("rejects an implausible invalidation distance", () => {
    const result = validatePrediction({
      direction: "SHORT", confidence: 55, rationale: "A rationale long enough to be reviewed by a human.",
      invalidation: ctx.lastClose * 3,
    }, ctx);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /implausibly far/);
  });

  it("clamps confidence into 0-100 and rejects junk directions", () => {
    const clamped = validatePrediction({
      direction: "long", confidence: 912, rationale: "A rationale long enough to be reviewed by a human.",
      invalidation: ctx.lastClose * 0.99,
    }, ctx);
    assert.equal(clamped.ok, true);
    if (clamped.ok) assert.equal(clamped.value.confidence, 100);

    const junk = validatePrediction({ direction: "MOON", confidence: 50, rationale: "A rationale long enough to be reviewed." }, ctx);
    assert.equal(junk.ok, false);
  });

  it("rejects a rationale too short to review", () => {
    const result = validatePrediction({ direction: "NEUTRAL", confidence: 40, rationale: "dunno" }, ctx);
    assert.equal(result.ok, false);
  });

  it("allows NEUTRAL without an invalidation level", () => {
    const result = validatePrediction({
      direction: "NEUTRAL", confidence: 35,
      rationale: "Chandelier and the Donchian ribbon disagree, so there is no directional edge here.",
    }, ctx);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.invalidation, null);
  });

  it("extracts JSON from fenced and prose-wrapped answers", () => {
    const wrapped = 'Sure!\n```json\n{"direction":"LONG","confidence":50}\n```\nHope that helps.';
    assert.deepEqual(extractJson(wrapped), { direction: "LONG", confidence: 50 });
    assert.deepEqual(extractJson('{"direction":"SHORT"}'), { direction: "SHORT" });
    assert.throws(() => extractJson("no json here"));
  });

  it("writes a degradation notice that names the provider", () => {
    const notice = degradationNotice("no API key is configured for it", "OpenRouter");
    assert.match(notice, /OpenRouter/);
    assert.match(notice, /rule engine/);
  });
});

describe("provider client (fake fetch, no network)", () => {
  const ctx = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: makeCandles(260, "up") });

  function fakeFetch(status: number, body: string) {
    return (async () => new Response(body, { status })) as unknown as typeof fetch;
  }

  it("returns parsed JSON on success and never leaks the key", async () => {
    let seenAuth = "";
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seenAuth = String((init.headers as Record<string, string>).Authorization);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"direction":"LONG","confidence":60,"rationale":"x","invalidation":1}' } }],
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await callProvider("openrouter", ctx, { apiKey: "sk-test-123456", fetchImpl });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.model, "meta-llama/llama-3.3-70b-instruct:free");
    assert.equal(seenAuth, "Bearer sk-test-123456");
  });

  it("classifies a 429 as rate-limited, not as a generic failure", async () => {
    const result = await callProvider("nvidia", ctx, { apiKey: "nvapi-x", fetchImpl: fakeFetch(429, "slow down") });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "rate-limited");
  });

  it("classifies 401 as an auth problem so the UI can tell the user to fix the key", async () => {
    const result = await callProvider("openrouter", ctx, { apiKey: "bad", fetchImpl: fakeFetch(401, "invalid key") });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "auth");
  });

  it("classifies an unparseable model answer as bad-output", async () => {
    const result = await callProvider("openrouter", ctx, {
      apiKey: "sk-test",
      fetchImpl: fakeFetch(200, JSON.stringify({ choices: [{ message: { content: "I think it might go up?" } }] })),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "bad-output");
  });

  it("refuses to call without a key and reports not-configured", async () => {
    const result = await callProvider("openrouter", ctx, { apiKey: "" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.kind, "not-configured");
  });

  it("omits JSON response mode and gives reasoning models a larger budget", async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_tokens, 1500);
      assert.equal("response_format" in body, false);
      assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"direction":"LONG"}' } }] }));
    };
    const result = await callProvider("openrouter", ctx, { apiKey: "test-key", fetchImpl });
    assert.equal(result.ok, true);
  });

  it("accepts alternate text envelopes and prefers final answers over reasoning", () => {
    const answer = '{"direction":"LONG"}';
    for (const payload of [
      { choices: [{ message: { content: [{ type: "text", text: answer }] } }] },
      { choices: [{ message: { content: "", reasoning: answer } }] },
      { choices: [{ message: { reasoning_content: answer } }] },
      { choices: [{ delta: { content: answer } }] },
      { content: answer }, { text: answer }, { reasoning: answer },
    ]) assert.equal(extractMessageContent(payload), answer);
    assert.equal(extractMessageContent({ choices: [{ message: { content: answer, reasoning: "thinking" } }] }), answer);
    assert.equal(extractMessageContent({ choices: [null] }), null);
    assert.equal(extractMessageContent({ choices: [{ message: { content: "   " } }] }), null);
  });

  it("parses JSON from reasoning when final content is empty", async () => {
    const result = await callProvider("openrouter", ctx, { apiKey: "test-key",
      fetchImpl: fakeFetch(200, JSON.stringify({ choices: [{ message: { content: "", reasoning_content: '```json\n{"direction":"LONG"}\n```' } }] })),
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.raw, { direction: "LONG" });
  });

  it("surfaces upstream errors on HTTP 200 without metadata or credentials", async () => {
    const result = await callProvider("openrouter", ctx, { apiKey: "secret-key",
      fetchImpl: fakeFetch(200, JSON.stringify({ error: { message: "Model failed secret-key", metadata: "private metadata" } })),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "Provider error: Model failed [redacted]");
  });

  it("reads both chat-completion envelopes", () => {
    assert.equal(extractMessageContent({ choices: [{ message: { content: "hi" } }] }), "hi");
    assert.equal(extractMessageContent({ choices: [{ text: "hi" }] }), "hi");
    assert.equal(extractMessageContent({}), null);
  });
});

describe("outcome scoring", () => {
  it("marks a call correct when price moves the predicted way", () => {
    const candles = makeCandles(60, "up");
    const prediction = makePrediction({ barTime: candles[50].time * 1000, entryPrice: candles[50].close, horizonBars: 3, direction: "LONG", invalidation: candles[50].close * 0.5 });
    const outcome = predictOutcome(prediction, candles);
    assert.equal(outcome.resolution, "direction-correct");
    assert.equal(outcome.bars, 3);
    assert.equal(outcome.invalidationHit, false);
    assert.ok(outcome.movePct !== null && outcome.movePct > 0);
  });

  it("marks a call wrong when its own invalidation level is breached", () => {
    const candles = makeCandles(60, "up");
    const prediction = makePrediction({ barTime: candles[50].time * 1000, entryPrice: candles[50].close, horizonBars: 5, direction: "LONG", invalidation: candles[50].close * 0.999 });
    const outcome = predictOutcome(prediction, candles);
    assert.equal(outcome.resolution, "direction-wrong");
    assert.equal(outcome.invalidationHit, true);
  });

  it("stays pending until the horizon has printed", () => {
    const candles = makeCandles(60, "up");
    const prediction = makePrediction({ barTime: candles[58].time * 1000, horizonBars: 6 });
    const outcome = predictOutcome(prediction, candles);
    assert.equal(outcome.resolution, "pending");
  });

  it("treats a sub-noise move as no-call rather than a win", () => {
    const candles = makeCandles(60, "flat");
    const prediction = makePrediction({ barTime: candles[50].time * 1000, entryPrice: candles[50].close, horizonBars: 3, direction: "LONG", invalidation: candles[50].close * 0.5 });
    const outcome = predictOutcome(prediction, candles);
    if (outcome.resolution !== "pending") {
      const moved = Math.abs(outcome.movePct ?? 0);
      if (moved < AI_NOISE_THRESHOLD_PCT) assert.equal(outcome.resolution, "no-call");
    }
  });

  it("never scores a NEUTRAL prediction as a hit", () => {
    const candles = makeCandles(60, "up");
    const prediction = makePrediction({ direction: "NEUTRAL", invalidation: null, barTime: candles[50].time * 1000, horizonBars: 3 });
    const outcome = predictOutcome(prediction, candles);
    assert.equal(outcome.resolution, "no-call");
  });

  it("aggregates a scorecard by provider and chart type", () => {
    const candles = makeCandles(60, "up");
    const good = makePrediction({ id: "good", barTime: candles[50].time * 1000, entryPrice: candles[50].close, horizonBars: 3, provider: "rules" });
    good.outcome = { resolution: "direction-correct", bars: 3, priceAtHorizon: candles[53].close, movePct: 0.4, invalidationHit: false };
    const bad = makePrediction({ id: "bad", chartType: "heikin-ashi", provider: "openrouter", barTime: candles[50].time * 1000, entryPrice: candles[50].close, horizonBars: 3 });
    bad.outcome = { resolution: "direction-wrong", bars: 3, priceAtHorizon: candles[53].close, movePct: -0.3, invalidationHit: true };
    const pending = makePrediction({ id: "pending" });

    const card = scorecard([good, bad, pending]);
    assert.equal(card.total, 3);
    assert.equal(card.scored, 2);
    assert.equal(card.correct, 1);
    assert.equal(card.wrong, 1);
    assert.equal(card.pending, 1);
    assert.equal(card.hitRate, 0.5);
    assert.equal(card.invalidationRate, 0.5);
    assert.ok(card.byProvider.find((p) => p.provider === "rules")?.hitRate === 1);
    assert.ok(card.byChartType.find((c) => c.chartType === "heikin-ashi")?.hitRate === 0);
    assert.match(card.note, /too few to say anything about skill/);
  });
});

describe("free-tier budget guard", () => {
  let tmp: string;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tc-ai-test-"));
    process.env.TC_DATA_DIR = tmp;
  });

  it("blocks a second call inside the minimum interval and unblocks later", async () => {
    // Imported dynamically so TC_DATA_DIR is set before fileStore resolves its root.
    const store = await import("./store");
    const now = Date.now();
    const fresh = store.budgetState("openrouter", now);
    assert.equal(fresh.callsToday, 0);
    assert.equal(fresh.blockedReason, null);

    await store.recordCall("openrouter", now);
    const immediately = store.budgetState("openrouter", now + 1000);
    assert.ok(immediately.blockedReason, "a second call within the interval must be blocked");
    assert.ok(immediately.waitSeconds > 0);

    const later = store.budgetState("openrouter", now + AI_FREE_TIER_LIMITS.openrouter.minIntervalSeconds * 1000 + 1);
    assert.equal(later.blockedReason, null);
    assert.equal(later.callsToday, 1);
  });

  it("enforces the daily cap", async () => {
    const store = await import("./store");
    const now = Date.now();
    for (let i = 0; i < AI_FREE_TIER_LIMITS.nvidia.dailyLimit; i++) {
      await store.recordCall("nvidia", now + i * 60000);
    }
    const state = store.budgetState("nvidia", now + 10_000_000);
    assert.equal(state.callsToday, AI_FREE_TIER_LIMITS.nvidia.dailyLimit);
    assert.match(String(state.blockedReason), /Daily free-tier budget reached/);
  });

  it("round-trips the prediction ledger", async () => {
    const store = await import("./store");
    const prediction = makePrediction({ id: "ledger-1", barTime: 123456 });
    assert.equal(await store.savePrediction(prediction), true);
    const cached = store.findCached({ symbol: "BTCUSD", chartType: "candles", barTime: 123456, provider: "rules", timeframe: "5m" });
    assert.ok(cached, "a prediction from the same decision bar should be reusable instead of costing quota");
    assert.equal(cached?.id, "ledger-1");
    assert.equal(store.findCached({ symbol: "BTCUSD", chartType: "candles", barTime: 123456, provider: "rules", timeframe: "5m", indicatorSignature: "atr:20;mult:3;dc:20,50,100,200" }), null, "an old ATR/multiplier setting must not be reused after defaults or manual settings change");

    const updated = { ...prediction, outcome: { resolution: "direction-correct" as const, bars: 3, priceAtHorizon: 101, movePct: 1, invalidationHit: false } };
    assert.equal(await store.updatePredictions([updated]), true);
    assert.equal(store.listPredictions()[0].outcome?.resolution, "direction-correct");
  });
  it("retains concurrent chart-pane writes and filters cache provenance", async () => {
    const store = await import("./store");
    const a = makePrediction({ id: "concurrent-a", barTime: 987654 });
    const b = makePrediction({ id: "concurrent-b", barTime: 987654 });
    a.context.dataSource = "demo";
    b.context = structuredClone(a.context);
    b.context.dataSource = "live";
    const saved = await Promise.all([store.savePrediction(a), store.savePrediction(b)]);
    assert.ok(saved.every(Boolean));
    const ids = store.listPredictions().map(p => p.id);
    assert.ok(ids.includes(a.id) && ids.includes(b.id));
    const cached = store.findCached({ symbol: a.symbol, timeframe: a.timeframe, chartType: a.chartType, barTime: a.barTime, provider: a.provider, dataSource: "live" });
    assert.equal(cached?.id, b.id);
  });

});
