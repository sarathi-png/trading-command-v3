"use client";
import Image from "next/image";
import { useState } from "react";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { Btn, Chip, Input, Panel } from "./ui";
import type { Delivery, DeliveryConfig } from "@/lib/notifications/service";
interface Status {
  config: DeliveryConfig;
  providers: { telegram: boolean; whatsapp: boolean };
  telegram: { configured: boolean; source: string | null; uiStorageAvailable: boolean };
  whatsappOptIn: { url: string; qrDataUrl: string } | null;
  recent: Delivery[];
  monitor: string;
}
export default function NotificationSettings() {
  const { data, error, refresh } = usePoll(
    () => api.get<Status>("/api/notifications"),
    30_000,
  );
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [token, setToken] = useState(""), [chatId, setChatId] = useState(""), [consent, setConsent] = useState(false);
  async function connectTelegram(clear = false) {
    setBusy(true);
    try {
      await api.post("/api/notifications", clear ? { action: "clear-telegram" } : { action: "save-telegram", token, chatId, consent });
      setToken(""); setChatId(""); setConsent(false); refresh();
      setMessage(clear ? "Stored Telegram credentials cleared. Environment credentials, if set, still take precedence." : "Encrypted Telegram credentials saved server-side. Start your bot conversation, enable messaging, then send a connection test; saving does not verify delivery.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Configuration failed"); }
    finally { setBusy(false); }
  }
  async function save(key: keyof DeliveryConfig, value: boolean) {
    setBusy(true);
    try {
      await api.post("/api/notifications", { [key]: value });
      refresh();
      setMessage("Preference saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }
  async function run(action: "test" | "scan") {
    setBusy(true);
    try {
      const res = await api.post<{ note?: string; skipped?: string }>(
        action === "scan" ? "/api/notifications/scan" : "/api/notifications",
        action === "test" ? { action: "test" } : {},
      );
      setMessage(
        res.note ??
          res.skipped ??
          "Scan finished. Inspect the delivery history below.",
      );
      refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title="SIGNAL NOTIFICATIONS"
      badge={<Chip>{data?.config.enabled ? "ENABLED" : "OFF"}</Chip>}
    >
      <div className="p-4 space-y-4 text-[12px] text-mut">
        <p>
          Get normal-chart setups and separate 5-minute Heikin-Ashi + Chandelier
          Exit / Donchian setups on Telegram or WhatsApp. These are review
          alerts, not orders. Demo alerts are off by default.
        </p>
        {(error || message) && (
          <p role="status" className="text-accent">
            {error || message}
          </p>
        )}
        {data && (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              {(Object.keys(data.config) as (keyof DeliveryConfig)[]).map(
                (key) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-lg border border-edge p-3"
                  >
                    <input
                      type="checkbox"
                      checked={data.config[key]}
                      disabled={busy}
                      onChange={(e) => void save(key, e.target.checked)}
                    />
                    {
                      (
                        {
                          enabled: "Enable messaging",
                          telegram: "Telegram",
                          whatsapp: "WhatsApp Cloud API",
                          whatsappConsent: "Confirm configured WhatsApp recipient explicitly opted in",
                          allowDemo: "Allow labelled demo alerts",
                          normal: "Normal candlestick signals",
                          heikinAshi: "Heikin-Ashi + Chandelier · 5m",
                        } as Record<keyof DeliveryConfig, string>
                      )[key]
                    }
                  </label>
                ),
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg bg-panel2 p-3">
                <strong>
                  Telegram ·{" "}
                  {data.providers.telegram ? "configured" : "not configured"}
                </strong>
                <p className="mt-1">
                  Start your bot conversation first. Provide the bot token and numeric chat ID below, or use TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID on the server. Environment values take precedence.
                </p>
                <p className="mt-1 text-dim">Credential source: {data.telegram.source ?? "none"}. UI secrets are encrypted with SESSION_SECRET and never returned by the API or included in the history mirror. A durable private data volume and stable secret are required.</p>
                <div className="mt-3 space-y-2">
                  <Input type="password" autoComplete="new-password" aria-label="Telegram bot token" placeholder="Telegram bot token" value={token} onChange={e=>setToken(e.target.value)} disabled={busy||!data.telegram.uiStorageAvailable}/>
                  <Input aria-label="Telegram chat ID" autoComplete="off" placeholder="Numeric chat ID" value={chatId} onChange={e=>setChatId(e.target.value)} disabled={busy||!data.telegram.uiStorageAvailable}/>
                  <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>This is my opted-in bot conversation.</label>
                  <div className="flex flex-wrap gap-2"><Btn disabled={busy||!token||!chatId||!consent||!data.telegram.uiStorageAvailable} onClick={()=>void connectTelegram()}>SAVE TELEGRAM SECURELY</Btn><Btn disabled={busy} onClick={()=>void connectTelegram(true)}>CLEAR STORED TELEGRAM</Btn></div>
                  {!data.telegram.uiStorageAvailable&&<p className="text-warn">UI storage needs a stable SESSION_SECRET of 32+ characters; server environment configuration still works.</p>}
                </div>
                <p className="mt-2 text-dim">Saving credentials does not enable messaging or place trades.
                </p>
              </div>
              <div className="rounded-lg bg-panel2 p-3">
                <strong>
                  WhatsApp ·{" "}
                  {data.providers.whatsapp ? "configured" : "not configured"}
                </strong>
                <p className="mt-1">
                  WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TO
                  and WHATSAPP_TEMPLATE_NAME. Requires recipient opt-in and an
                  approved template with one text body variable. Provider
                  charges may apply. The consent checkbox is an explicit operator confirmation for WHATSAPP_TO; scanning alone is not proof of consent.
                </p>
                {data.whatsappOptIn ? <div className="mt-3 space-y-2">
                  <Image src={data.whatsappOptIn.qrDataUrl} width={240} height={240} unoptimized alt="WhatsApp business sender opt-in chat QR code" className="rounded-lg max-w-full"/>
                  <p className="text-ink">Scan to open the configured business sender&apos;s chat, then send the opt-in message. This does not pair a personal account, register your number automatically, or enable alerts by itself.</p>
                  <a href={data.whatsappOptIn.url} target="_blank" rel="noopener noreferrer" className="text-accent underline break-all">Open the same opt-in chat</a>
                  <p className="text-dim">The server&apos;s WHATSAPP_TO must match the consenting recipient. Credentials, approved template, channel enablement and the consent checkbox are still required.</p>
                </div> : <p className="mt-3 text-warn">QR unavailable: set WHATSAPP_SENDER_NUMBER to the real Cloud API business sender in international format. No placeholder QR or personal-account pairing is offered.</p>}
                <p className="mt-2 text-dim">Use the sender&apos;s real phone number, not the opaque WHATSAPP_PHONE_NUMBER_ID.
                </p>
              </div>
            </div>
            <p>
              {data.monitor} Background scans cover the first 10 watchlist
              symbols. Messages are capped at 100 per channel/day; identical
              decision-bar signals are deduplicated.
            </p>
            <div className="flex flex-wrap gap-2">
              <Btn
                disabled={busy || !data.config.enabled}
                onClick={() => void run("test")}
              >
                SEND CONNECTION TEST
              </Btn>
              <Btn
                disabled={busy || !data.config.enabled}
                onClick={() => void run("scan")}
              >
                SCAN WATCHLIST NOW
              </Btn>
            </div>
            <div>
              <h4 className="microlabel mb-2">
                DELIVERY HISTORY · provider acceptance, not read receipts
              </h4>
              {!data.recent.length ? (
                <p>No messages attempted yet.</p>
              ) : (
                <ul className="space-y-2">
                  {data.recent.slice(0, 8).map((row) => (
                    <li key={row.id} className="rounded border border-edge p-2">
                      <strong>
                        {row.channel} · {row.symbol} · {row.chart} ·{" "}
                        {row.status}
                      </strong>
                      <span className="block text-dim">
                        {new Date(row.updatedAt).toLocaleString()} · attempt{" "}
                        {row.attempts}
                        {row.error ? ` · ${row.error}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
/** Mounted only after successful login; no credentials or provider calls in the browser. */
export function NotificationMonitor() {
  usePoll(() => api.post("/api/notifications/scan", {}), 60_000);
  return null;
}
