/** Server-only messaging outbox. Secrets are never API output. */
import { resolveTelegram } from "./credentials";
import { createHash } from "node:crypto";
import { readDoc, writeDoc } from "../fileStore";
export type Channel = "telegram" | "whatsapp";
export interface DeliveryConfig {
  enabled: boolean;
  telegram: boolean;
  whatsapp: boolean;
  whatsappConsent: boolean;
  allowDemo: boolean;
  normal: boolean;
  heikinAshi: boolean;
}
export const DEFAULT_DELIVERY: DeliveryConfig = {
  enabled: false,
  telegram: true,
  whatsapp: false,
  whatsappConsent: false,
  allowDemo: false,
  normal: true,
  heikinAshi: true,
};
export interface SignalNotice {
  symbol: string;
  timeframe: string;
  chart: "normal" | "heikin-ashi" | "digest";
  strategy: string;
  direction: "LONG" | "SHORT" | "REPORT";
  barTime: number;
  source: "demo" | "live";
  entry: number | null;
  stop: number | null;
  target: number | null;
  reasons: string[];
}
export interface Delivery {
  id: string;
  channel: Channel;
  symbol: string;
  chart: string;
  createdAt: number;
  updatedAt: number;
  status: "sending" | "sent" | "failed" | "unknown";
  attempts: number;
  error: string | null;
}
const OUTBOX = "notification-outbox.json",
  CONFIG = "notification-settings.json";
export function deliveryConfig(): DeliveryConfig {
  return {
    ...DEFAULT_DELIVERY,
    ...readDoc<Partial<DeliveryConfig>>(CONFIG, {}),
  };
}
export async function saveDeliveryConfig(input: unknown): Promise<boolean> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw Error("Expected notification settings");
  const current = deliveryConfig();
  for (const key of Object.keys(DEFAULT_DELIVERY) as (keyof DeliveryConfig)[]) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      if (typeof value !== "boolean") throw Error(`Invalid ${key}`);
      current[key] = value;
    }
  }
  return writeDoc(CONFIG, current);
}
export function deliveries(): Delivery[] {
  const rows = readDoc<Delivery[]>(OUTBOX, []);
  return Array.isArray(rows) ? rows : [];
}
export function configured(channel: Channel): boolean {
  return channel === "telegram"
    ? !!resolveTelegram()
    : !!(
        process.env.WHATSAPP_ACCESS_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_TO &&
        process.env.WHATSAPP_TEMPLATE_NAME
      );
}
export function noticeKey(notice: SignalNotice, channel: Channel): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        channel,
        notice.symbol,
        notice.timeframe,
        notice.chart,
        notice.strategy,
        notice.direction,
        notice.barTime,
        notice.source,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}
export function noticeText(n: SignalNotice): string {
  return [
    `Trading Command · ${n.source === "demo" ? "DEMO / SIMULATED" : "LIVE MARKET DATA"}`,
    `${n.symbol} · ${n.timeframe} · ${n.chart === "heikin-ashi" ? "Heikin-Ashi + Chandelier Exit" : n.chart === "digest" ? "market movers report" : "normal candlestick chart"}`,
    `${n.direction === "REPORT" ? "ANALYSIS SNAPSHOT" : n.direction === "LONG" ? "LONG SETUP (buy-side candidate)" : "SHORT SETUP (sell-side candidate)"} · ${n.strategy}`,
    `Decision bar: ${new Date(n.barTime).toISOString()}`,
    `Entry estimate ${n.entry ?? "n/a"} · Invalidation ${n.stop ?? "n/a"} · Target estimate ${n.target ?? "n/a"}`,
    n.reasons.slice(0, 5).join("\n").slice(0, 2100),
    "For review only, not advice. No order placed. Short signals refer to futures, not selling assets you do not own.",
  ]
    .join("\n")
    .slice(0, 3000);
}
/** Testable transport: errors never include response bodies or credential URLs. */
export async function sendMessage(
  channel: Channel,
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  let url: string,
    body: unknown,
    headers: Record<string, string> = { "Content-Type": "application/json" };
  if (channel === "telegram") {
    const telegram = resolveTelegram();
    if (!telegram) throw Error("Telegram not configured");
    url = `https://api.telegram.org/bot${telegram.token}/sendMessage`;
    body = {
      chat_id: telegram.chatId,
      text,
      disable_web_page_preview: true,
    };
  } else {
    // Template text parameters cannot rely on multiline formatting. Reserve
    // space for the safety notice when a long market digest is shortened.
    const compact = text.replace(/\s+/g, " ").trim();
    const templateText = compact.length > 850
      ? compact.slice(0, 850) + " Report shortened. For review only, not advice. No order placed."
      : compact;
    const version = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
    const phone = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
    if (!/^v\d+\.0$/.test(version) || !/^\d+$/.test(phone))
      throw Error("Invalid WhatsApp API version or phone-number ID");
    url = `https://graph.facebook.com/${version}/${phone}/messages`;
    headers = {
      ...headers,
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    };
    body = {
      messaging_product: "whatsapp",
      to: process.env.WHATSAPP_TO,
      type: "template",
      template: {
        name: process.env.WHATSAPP_TEMPLATE_NAME,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US" },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: templateText }],
          },
        ],
      },
    };
  }
  let res: Response;
  try {
    res = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw Error("Network failure or timeout; delivery may be unknown.");
  }
  if (!res.ok)
    throw Error(
      `Provider rejected delivery (HTTP ${res.status}); check credentials, recipient and template.`,
    );
  const result = await res.json().catch(() => null);
  if (channel === "telegram" ? result?.ok !== true : !result?.messages?.[0]?.id)
    throw Error("Provider did not confirm message acceptance.");
}
let queue: Promise<unknown> = Promise.resolve();
export function dispatchNotice(
  notice: SignalNotice,
  fetcher: typeof fetch = fetch,
): Promise<Delivery[]> {
  const work = queue.then(() => dispatchLocked(notice, fetcher));
  queue = work.catch(() => undefined);
  return work;
}
async function dispatchLocked(
  n: SignalNotice,
  fetcher: typeof fetch,
): Promise<Delivery[]> {
  const config = deliveryConfig();
  if (
    !config.enabled ||
    (n.source === "demo" && !config.allowDemo) ||
    (n.chart === "normal" && !config.normal) ||
    (n.chart === "heikin-ashi" && (!config.heikinAshi || n.timeframe !== "5m"))
  )
    return [];
  const results: Delivery[] = [];
  for (const channel of ["telegram", "whatsapp"] as Channel[]) {
    if (!config[channel] || !configured(channel) || (channel === "whatsapp" && !config.whatsappConsent)) continue;
    const id = noticeKey(n, channel),
      now = Date.now(),
      rows = deliveries();
    const prior = rows.find((r) => r.id === id);
    // Unknown outcomes are NOT automatically retried: a timeout may have delivered.
    if (
      prior &&
      (prior.status !== "failed" ||
        prior.attempts >= 3 ||
        now - prior.updatedAt < 60_000)
    )
      continue;
    if (
      rows.filter((r) => r.channel === channel && now - r.createdAt < 86400000)
        .length >= 100
    )
      continue;
    const row: Delivery = {
      id,
      channel,
      symbol: n.symbol,
      chart: n.chart,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      status: "sending",
      attempts: (prior?.attempts ?? 0) + 1,
      error: null,
    };
    const store = () =>
      writeDoc(
        OUTBOX,
        [...deliveries().filter((r) => r.id !== id), row].slice(-500),
      );
    if (!(await store())) {
      results.push({
        ...row,
        status: "failed",
        error: "Outbox storage unavailable; message not sent.",
      });
      continue;
    }
    try {
      await sendMessage(channel, noticeText(n), fetcher);
      row.status = "sent";
    } catch (e) {
      row.error = e instanceof Error ? e.message : "Delivery failed";
      row.status =
        row.error.startsWith("Network") ||
        row.error.startsWith("Provider did not confirm")
          ? "unknown"
          : "failed";
    }
    row.updatedAt = Date.now();
    if (!(await store()))
      row.error =
        "Final delivery status could not be persisted; inspect provider before retrying.";
    results.push({ ...row });
  }
  return results;
}
