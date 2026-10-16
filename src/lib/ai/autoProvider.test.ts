import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiContext } from "./types";
it("rotates model-specific failures after spacing, counts attempts and never rotates an account quota", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tc-free-rotation-"));
  process.env.TC_DATA_DIR = directory;
  const { callFreeProvider } = await import("./autoProvider");
  const { budgetState } = await import("./store");
  const { buildAiContext } = await import("./context");
  const context: AiContext = buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: Array.from({ length: 100 }, (_, i) => ({ time: i * 300, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 100 })) });
  const actualNow = Date.now;
  let now = actualNow();
  Date.now = () => now;
  const attempted: string[] = [];
  const fake = (async (url: unknown, options: RequestInit) => {
    if (String(url).endsWith("/models")) return Response.json({ data: ["a", "b", "c"].map(id => ({ id, context_length: 8192, pricing: { prompt: "0", completion: "0" } })) });
    const model = JSON.parse(String(options.body)).model;
    attempted.push(model);
    if (model === "a") return new Response("model-specific rate limit", { status: 429 });
    return new Response("account daily limit reached", { status: 429 });
  }) as typeof fetch;
  try {
    const first = await callFreeProvider("openrouter", context, "rotation-key", fake);
    assert.equal(first.ok, false);
    assert.deepEqual(attempted, ["a"]);
    await callFreeProvider("openrouter", context, "rotation-key", fake);
    assert.deepEqual(attempted, ["a"], "spacing forbids immediate retry");
    now += 46000;
    await callFreeProvider("openrouter", context, "rotation-key", fake);
    assert.deepEqual(attempted, ["a", "b"]);
    now += 46000;
    await callFreeProvider("openrouter", context, "rotation-key", fake);
    assert.deepEqual(attempted, ["a", "b", "b"], "account quota must not rotate to c");
    assert.equal(budgetState("openrouter").callsToday, 3);
  } finally { Date.now = actualNow; fs.rmSync(directory, { recursive: true, force: true }); }
});
