import { it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AiContext } from "./types";

// fileStore freezes its data directory at first load, so point the whole suite
// at one temp dir (set before any module pulls in fileStore). Each test then
// resets the shared free-tier budget document to stay isolated; in-memory model
// cooldowns stay isolated by using a distinct API key per test (the cooldown key
// is a hash of the provider + key).
const SUITE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tc-free-suite-"));
process.env.TC_DATA_DIR = SUITE_DIR;

async function resetBudget(): Promise<void> {
  const { writeDoc } = await import("../fileStore");
  await writeDoc("ai-budget.json", { days: {}, lastCallAt: {} });
}
async function makeContext(): Promise<AiContext> {
  const { buildAiContext } = await import("./context");
  return buildAiContext({ symbol: "BTCUSD", timeframe: "5m", chartType: "candles", candles: Array.from({ length: 100 }, (_, i) => ({ time: i * 300, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 100 })) });
}
const modelsEndpoint = (ids: string[]) => (url: unknown) => String(url).endsWith("/models")
  ? Response.json({ data: ids.map(id => ({ id, context_length: 8192, pricing: { prompt: "0", completion: "0" } })) })
  : null;

it("skips a model-specific rate limit in-request but stops at an account quota", async () => {
  await resetBudget();
  const { callFreeProvider } = await import("./autoProvider");
  const { budgetState } = await import("./store");
  const context = await makeContext();
  const actualNow = Date.now;
  let now = actualNow();
  Date.now = () => now;
  const attempted: string[] = [];
  const fake = (async (url: unknown, options: RequestInit) => {
    const listed = modelsEndpoint(["a", "b", "c"])(url);
    if (listed) return listed;
    const model = JSON.parse(String(options.body)).model as string;
    attempted.push(model);
    if (model === "a") return new Response("model-specific rate limit", { status: 429 });
    return new Response("account daily limit reached", { status: 429 });
  }) as typeof fetch;
  try {
    const first = await callFreeProvider("openrouter", context, "key-rotation", fake);
    assert.equal(first.ok, false);
    // a (model-specific 429) is skipped in-request; b (account 429) stops the
    // request, so c is never reached — an account quota must not rotate.
    assert.deepEqual(attempted, ["a", "b"]);
    assert.equal(budgetState("openrouter").callsToday, 2, "both models were attempted in one request");
    // A second, immediate predict() call is still throttled by min-interval spacing.
    await callFreeProvider("openrouter", context, "key-rotation", fake);
    assert.deepEqual(attempted, ["a", "b"], "spacing forbids an immediate second request");
  } finally { Date.now = actualNow; }
});

it("retries the next verified model in-request when one returns non-JSON prose", async () => {
  await resetBudget();
  const { callFreeProvider } = await import("./autoProvider");
  const context = await makeContext();
  const attempted: string[] = [];
  const fake = (async (url: unknown, options: RequestInit) => {
    const listed = modelsEndpoint(["a", "b"])(url);
    if (listed) return listed;
    const model = JSON.parse(String(options.body)).model as string;
    attempted.push(model);
    // a answers with prose and no JSON object -> bad-output; b returns usable JSON.
    if (model === "a") return Response.json({ choices: [{ message: { content: "I think it might go up?" } }] });
    return Response.json({ choices: [{ message: { content: '{"direction":"LONG"}' } }] });
  }) as typeof fetch;
  const result = await callFreeProvider("openrouter", context, "key-badoutput", fake);
  assert.equal(result.ok, true);
  assert.deepEqual(attempted, ["a", "b"], "bad-output model a is skipped and b is used in the same request");
  if (result.ok) assert.deepEqual(result.raw, { direction: "LONG" });
});

it("does not rotate at all on an account-level quota", async () => {
  await resetBudget();
  const { callFreeProvider } = await import("./autoProvider");
  const context = await makeContext();
  const attempted: string[] = [];
  const fake = (async (url: unknown, options: RequestInit) => {
    const listed = modelsEndpoint(["a", "b", "c"])(url);
    if (listed) return listed;
    attempted.push(JSON.parse(String(options.body)).model as string);
    return new Response("account daily limit reached", { status: 429 });
  }) as typeof fetch;
  const result = await callFreeProvider("openrouter", context, "key-account", fake);
  assert.equal(result.ok, false);
  assert.deepEqual(attempted, ["a"], "an account quota stops before trying b or c");
});
