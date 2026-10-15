import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SignalNotice } from "./service";
let svc: typeof import("./service");
const original = { ...process.env };
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tc-notifications-"));
before(async () => {
  process.env.TC_DATA_DIR = directory;
  process.env.TELEGRAM_BOT_TOKEN = "test-bot";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  svc = await import("./service");
});
after(() => {
  for (const key of [
    "TC_DATA_DIR",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_CHAT_ID",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_TO",
    "WHATSAPP_TEMPLATE_NAME",
  ]) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  fs.rmSync(directory, { recursive: true, force: true });
});
const notice = (
  id: string,
  source: "live" | "demo" = "live",
): SignalNotice => ({
  symbol: id,
  timeframe: "5m",
  chart: "normal",
  strategy: "test",
  direction: "LONG",
  barTime: Date.now(),
  source,
  entry: 100,
  stop: 95,
  target: 110,
  reasons: ["Indicators agree."],
});
const success = (async () => Response.json({ ok: true })) as typeof fetch;
describe("notification delivery controls", () => {
  it("starts disabled and sends nothing before opt-in", async () => {
    let calls = 0;
    await svc.dispatchNotice(notice("OFF"), (async () => {
      calls++;
      return Response.json({ ok: true });
    }) as typeof fetch);
    assert.equal(calls, 0);
  });
  it("rejects malformed settings rather than coercing strings", async () => {
    await assert.rejects(svc.saveDeliveryConfig({ enabled: "true" }));
  });
  it("requires a configured provider and explicit demo opt-in", async () => {
    await svc.saveDeliveryConfig({ enabled: true });
    let calls = 0;
    await svc.dispatchNotice(notice("DEMO", "demo"), (async () => {
      calls++;
      return Response.json({ ok: true });
    }) as typeof fetch);
    assert.equal(calls, 0);
  });
  it("deduplicates simultaneous identical events before sending", async () => {
    const n = notice("SAME");
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return Response.json({ ok: true });
    }) as typeof fetch;
    await Promise.all([
      svc.dispatchNotice(n, fetcher),
      svc.dispatchNotice(n, fetcher),
    ]);
    assert.equal(calls, 1);
    assert.equal(svc.deliveries().filter((r) => r.symbol === "SAME").length, 1);
  });
  it("separates chart type, bar, source and channel keys", () => {
    const n = notice("KEY");
    assert.notEqual(
      svc.noticeKey(n, "telegram"),
      svc.noticeKey({ ...n, chart: "heikin-ashi" }, "telegram"),
    );
    assert.notEqual(svc.noticeKey(n, "telegram"), svc.noticeKey(n, "whatsapp"));
    assert.notEqual(
      svc.noticeKey(n, "telegram"),
      svc.noticeKey({ ...n, source: "demo" }, "telegram"),
    );
    assert.notEqual(
      svc.noticeKey(n, "telegram"),
      svc.noticeKey({ ...n, barTime: n.barTime + 300000 }, "telegram"),
    );
  });
  it("honours chart filter and the dedicated 5m HA frame", async () => {
    const n = notice("HA");
    n.chart = "heikin-ashi";
    n.timeframe = "15m";
    assert.deepEqual(await svc.dispatchNotice(n, success), []);
    await svc.saveDeliveryConfig({ normal: false });
    assert.deepEqual(await svc.dispatchNotice(notice("FILTER"), success), []);
    await svc.saveDeliveryConfig({ normal: true });
  });
  it("records provider rejection without secrets or response body", async () => {
    const n = notice("FAIL");
    const res = await svc.dispatchNotice(
      n,
      (async () =>
        new Response("secret response content", {
          status: 429,
        })) as typeof fetch,
    );
    assert.equal(res[0].status, "failed");
    assert.match(res[0].error!, /429/);
    assert.ok(!res[0].error!.includes("secret"));
    assert.deepEqual(await svc.dispatchNotice(n, success), []);
  });
  it("does not automatically resend after an ambiguous network failure", async () => {
    const n = notice("TIMEOUT");
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      throw Error("contains-secret-token");
    }) as typeof fetch;
    const res = await svc.dispatchNotice(n, fetcher);
    assert.equal(res[0].status, "unknown");
    assert.ok(!res[0].error!.includes("contains-secret"));
    await svc.dispatchNotice(n, fetcher);
    assert.equal(calls, 1);
  });
  it("requires application-level provider acknowledgement, not HTTP 200 alone", async () => {
    const res = await svc.dispatchNotice(notice("BADBODY"), (async () =>
      Response.json({ ok: false })) as typeof fetch);
    assert.equal(res[0].status, "unknown");
  });
  it("builds proactive WhatsApp templates and keeps credentials server-side", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "test-whatsapp-token";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "123456";
    process.env.WHATSAPP_TO = "919999999999";
    process.env.WHATSAPP_TEMPLATE_NAME = "signal_alert";
    let payload: Record<string, unknown> = {};
    let auth = "";
    await svc.sendMessage("whatsapp", "Test message", (async (_url, opts) => {
      payload = JSON.parse(String(opts?.body));
      auth = String((opts?.headers as Record<string, string>).Authorization);
      return Response.json({ messages: [{ id: "accepted" }] });
    }) as typeof fetch);
    assert.equal(payload.type, "template");
    assert.equal(payload.messaging_product, "whatsapp");
    assert.equal(auth, "Bearer test-whatsapp-token");
    assert.ok(!JSON.stringify(payload).includes("test-whatsapp-token"));
  });
  it("never dispatches WhatsApp without recipient consent", async () => {
    await svc.saveDeliveryConfig({ enabled: true, telegram: false, whatsapp: true, whatsappConsent: false });
    let calls = 0;
    assert.deepEqual(await svc.dispatchNotice(notice("NO-WHATSAPP-CONSENT"), (async () => { calls++; return new Response("{}"); }) as typeof fetch), []);
    assert.equal(calls, 0);
    await svc.saveDeliveryConfig({ telegram: true, whatsapp: false });
  });
  it("includes source, chart, invalidation and no-advice language in alerts", () => {
    const text = svc.noticeText({
      ...notice("BTCUSD", "demo"),
      chart: "heikin-ashi",
    });
    assert.match(text, /DEMO/);
    assert.match(text, /Heikin-Ashi/);
    assert.match(text, /Invalidation 95/);
    assert.match(text, /No order placed/);
  });
});
