/** Server-only encrypted Telegram credentials. The API never reads secrets back. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readDoc, writeDoc } from "../fileStore";
const DOC = "notification-secrets.json"; // deliberately NOT in HF mirror ALL_DOCS
interface Sealed { iv: string; tag: string; body: string }
interface TelegramSecret { token: string; chatId: string }
function key(): Buffer | null {
  const secret = process.env.SESSION_SECRET;
  return secret && secret.length >= 32 ? createHash("sha256").update(`notification-credentials:${secret}`).digest() : null;
}
export function resolveTelegram(): (TelegramSecret & { source: "environment" | "encrypted-file" }) | null {
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
    return { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, source: "environment" };
  const sealed = readDoc<Sealed | null>(DOC, null), encryptionKey = key();
  if (!sealed || !encryptionKey) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(sealed.iv,"base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag,"base64"));
    const secret = JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.body,"base64")),decipher.final()]).toString("utf8")) as TelegramSecret;
    return secret.token && secret.chatId ? { ...secret, source: "encrypted-file" } : null;
  } catch { return null; }
}
export function telegramStatus() {
  return { configured: !!resolveTelegram(), source: resolveTelegram()?.source ?? null, uiStorageAvailable: !!key() };
}
export async function saveTelegramCredentials(body: unknown): Promise<boolean> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error("Expected Telegram configuration");
  const input = body as Record<string, unknown>;
  if (input.action === "clear-telegram") return writeDoc(DOC, null);
  const encryptionKey = key();
  if (!encryptionKey) throw Error("UI credential storage requires a stable SESSION_SECRET of at least 32 characters; otherwise use server environment variables");
  if (typeof input.token !== "string" || !/^\d{5,14}:[A-Za-z0-9_-]{20,100}$/.test(input.token.trim())) throw Error("Invalid Telegram bot token format");
  if (typeof input.chatId !== "string" || !/^-?\d{1,20}$/.test(input.chatId.trim())) throw Error("Enter the numeric Telegram chat ID");
  if (input.consent !== true) throw Error("Confirm this is your opted-in bot conversation");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ token: input.token.trim(), chatId: input.chatId.trim() }),"utf8"),cipher.final()]);
  return writeDoc(DOC, { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), body: encrypted.toString("base64") });
}
export function whatsappOptInUrl(): string | null {
  const phone = process.env.WHATSAPP_SENDER_NUMBER?.trim().replace(/^\+/, "");
  if (!phone || !/^[1-9]\d{7,14}$/.test(phone)) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent("I would like to opt in to Trading Command signal alerts. I understand these are review alerts, not financial advice or orders.")}`;
}
