import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  createApiClient,
  pathNeedsWorkspace,
  type FetchLike,
  type FetchLikeResponse,
} from "../src/api/client";

function respond(status: number, body: unknown = { ok: true }): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  };
}

function client(options: {
  status?: number;
  body?: unknown;
  onUnauthorized?: () => void;
  fetchImpl?: FetchLike;
  token?: string | null;
  workspace?: "paper" | "live";
} = {}) {
  const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = [];
  const fetchImpl: FetchLike = options.fetchImpl ?? (async (url, init) => {
    calls.push({ url, init });
    return respond(options.status ?? 200, options.body);
  });
  const api = createApiClient({
    baseUrl: "https://api.example.com/",
    workspace: options.workspace ?? "paper",
    getToken: () => (options.token === undefined ? "session-token" : options.token),
    onUnauthorized: options.onUnauthorized,
    timeoutMs: 50,
    fetchImpl,
  });
  return { api, calls };
}

describe("API client", () => {
  it("sends the bearer token and the workspace header", async () => {
    const { api, calls } = client();
    await api.get("/api/paper");
    assert.equal(calls[0].url, "https://api.example.com/api/paper");
    assert.equal(calls[0].init?.headers?.authorization, "Bearer session-token");
    assert.equal(calls[0].init?.headers?.["x-tc-workspace"], "paper");
  });

  it("omits the workspace header where the server rejects it", async () => {
    assert.equal(pathNeedsWorkspace("/api/settings"), false);
    assert.equal(pathNeedsWorkspace("/api/settings?x=1"), false);
    assert.equal(pathNeedsWorkspace("/api/health"), false);
    assert.equal(pathNeedsWorkspace("/api/auth/mobile"), false);
    assert.equal(pathNeedsWorkspace("/api/paper"), true);

    const { api, calls } = client();
    await api.get("/api/settings");
    assert.equal(calls[0].init?.headers?.["x-tc-workspace"], undefined);
  });

  it("serializes JSON bodies and sets the content type", async () => {
    const { api, calls } = client();
    await api.post("/api/paper", { action: "place", qty: 1 });
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(calls[0].init?.headers?.["content-type"], "application/json");
    assert.equal(calls[0].init?.body, JSON.stringify({ action: "place", qty: 1 }));
  });

  it("sends no authorization header before login", async () => {
    const { api, calls } = client({ token: null });
    await api.get("/api/health");
    assert.equal(calls[0].init?.headers?.authorization, undefined);
  });

  it("surfaces the server error string", async () => {
    const { api } = client({ status: 403, body: { error: "Paper execution is unavailable" } });
    await assert.rejects(
      () => api.post("/api/paper", {}),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 403 &&
        error.message === "Paper execution is unavailable"
    );
  });

  it("falls back to a status message for a non-JSON error", async () => {
    const { api } = client({ status: 502, body: undefined });
    await assert.rejects(
      () => api.get("/api/market/tickers"),
      (error: unknown) => error instanceof ApiError && error.status === 502 && /HTTP 502/.test(error.message)
    );
  });

  it("notifies the session layer on 401", async () => {
    let signedOut = 0;
    const { api } = client({ status: 401, body: { error: "Authentication required." }, onUnauthorized: () => { signedOut += 1; } });
    await assert.rejects(() => api.get("/api/paper"));
    assert.equal(signedOut, 1);
  });

  it("aborts a hanging request instead of spinning forever", async () => {
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const { api } = client({ fetchImpl: hanging });
    await assert.rejects(
      () => api.get("/api/system"),
      (error: unknown) => error instanceof ApiError && error.status === 0 && /timed out/.test(error.message)
    );
  });

  it("rejects an empty base URL", () => {
    assert.throws(
      () => createApiClient({ baseUrl: "  ", workspace: "paper", getToken: () => null }),
      /base URL is required/
    );
  });
});
