import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const old={...process.env}, dir=fs.mkdtempSync(path.join(os.tmpdir(),"tc-notification-secrets-"));
let credentials: typeof import("./credentials");
before(async()=>{process.env.TC_DATA_DIR=dir;process.env.SESSION_SECRET="test-notification-encryption-secret-of-40-chars";delete process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_CHAT_ID;credentials=await import("./credentials");});
after(()=>{for(const k of ["TC_DATA_DIR","SESSION_SECRET","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","WHATSAPP_SENDER_NUMBER"]){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}fs.rmSync(dir,{recursive:true,force:true});});
describe("messaging credentials and honest WhatsApp QR",()=>{
  it("requires explicit recipient consent and rejects malformed credentials",async()=>{await assert.rejects(credentials.saveTelegramCredentials({token:"x",chatId:"123",consent:true}));await assert.rejects(credentials.saveTelegramCredentials({token:"123456:abcdefghijklmnopqrstuvwxyz",chatId:"123",consent:false}));});
  it("stores encrypted Telegram secrets and exposes status only",async()=>{assert.equal(await credentials.saveTelegramCredentials({token:"123456:abcdefghijklmnopqrstuvwxyz",chatId:"12345",consent:true}),true);const stored=fs.readFileSync(path.join(dir,"notification-secrets.json"),"utf8");assert.ok(!stored.includes("abcdefghijklmnopqrstuvwxyz"));assert.ok(!stored.includes("12345"));assert.equal(credentials.resolveTelegram()?.token,"123456:abcdefghijklmnopqrstuvwxyz");assert.ok(!JSON.stringify(credentials.telegramStatus()).includes("abcdefghijklmnopqrstuvwxyz"));});
  it("environment configuration wins over stored credentials",()=>{process.env.TELEGRAM_BOT_TOKEN="env-token";process.env.TELEGRAM_CHAT_ID="env-chat";assert.equal(credentials.resolveTelegram()?.source,"environment");delete process.env.TELEGRAM_BOT_TOKEN;delete process.env.TELEGRAM_CHAT_ID;});
  it("cannot decrypt with a rotated session secret and does not expose ciphertext errors",()=>{const secret=process.env.SESSION_SECRET;process.env.SESSION_SECRET="a-different-valid-secret-of-over-32-characters";assert.equal(credentials.resolveTelegram(),null);process.env.SESSION_SECRET=secret;});
  it("does not invent a QR target without a configured sender",()=>{delete process.env.WHATSAPP_SENDER_NUMBER;assert.equal(credentials.whatsappOptInUrl(),null);process.env.WHATSAPP_SENDER_NUMBER="https://malicious.example";assert.equal(credentials.whatsappOptInUrl(),null);});
  it("QR points to the actual business sender opt-in chat, never account pairing",()=>{process.env.WHATSAPP_SENDER_NUMBER="+919876543210";const url=new URL(credentials.whatsappOptInUrl()!);assert.equal(url.host,"wa.me");assert.equal(url.pathname,"/919876543210");assert.match(url.searchParams.get("text")!,/opt in/);});
  it("clears stored secrets without silently enabling notifications",async()=>{assert.equal(await credentials.saveTelegramCredentials({action:"clear-telegram"}),true);assert.equal(credentials.resolveTelegram(),null);});
});
