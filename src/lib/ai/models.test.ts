import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { freeModels, discoverFreeModels } from "./models";
const model = (id: string, extra: object = {}) => ({ id, name: id, context_length: 8192, pricing: { prompt: "0", completion: "0" }, ...extra });
describe("verified free model discovery", () => {
  it("rejects paid, unpriced, blank-price and negative-price models regardless of suffix", () => {
    const models = freeModels({ data: [model("yes"), model("paid:free", { pricing: { prompt: "0.01", completion: "0" } }), model("unpriced", { pricing: undefined }), model("blank", { pricing: { prompt: "", completion: "0" } }), model("negative", { pricing: { prompt: "-1", completion: "0" } })] });
    assert.deepEqual(models.map(m => m.id), ["yes"]);
  });
  it("rejects additional paid request fees and nontext outputs", () => {
    assert.deepEqual(freeModels({ data: [model("fee", { pricing: { prompt: 0, completion: 0, request: 1 } }), model("image", { architecture: { output_modalities: ["image"] } })] }), []);
  });
  it("ranks structured-output compatibility before usable context and deduplicates", () => {
    const models = freeModels({ data: [model("large", { context_length: 100000 }), model("structured", { supported_parameters: ["response_format"] }), model("structured", { supported_parameters: ["response_format"] })] });
    assert.deepEqual(models.map(m => m.id), ["structured", "large"]);
  });
  it("rejects malformed catalogs and invalid context sizes", () => {
    assert.deepEqual(freeModels(null), []);
    assert.deepEqual(freeModels({ data: [model("nan", { context_length: "bogus" }), model("small", { context_length: 50 })] }), []);
  });
  it("uses an authenticated catalog call and never invents free pricing for NVIDIA", async () => {
    let authorization = "";
    const fake = (async (_url: unknown, options: RequestInit) => {
      authorization = (options.headers as Record<string, string>).Authorization;
      return Response.json({ data: [{ id: "unpriced-nvidia" }] });
    }) as typeof fetch;
    assert.deepEqual(await discoverFreeModels("nvidia", "test-only-discovery-key", fake), []);
    assert.equal(authorization, "Bearer test-only-discovery-key");
  });
  it("does not expose provider error bodies", async () => {
    const fake = (async () => new Response("private-account-id", { status: 401 })) as typeof fetch;
    await assert.rejects(discoverFreeModels("openrouter", "test-only-bad-key", fake), error => error instanceof Error && !error.message.includes("private-account-id"));
  });
});
