/**
 * Minimal HTTP helpers: request ids, bounded body reading, JSON responses and
 * an optional strict CORS allowlist.
 *
 * Everything here is written to fail closed: an oversized body, a wrong
 * content type or an unexpected method is refused before any handler runs.
 */
import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { GatewayError, badRequest } from "./errors.js";

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,72}$/;

/**
 * Correlation id. A well-formed `x-request-id` from the caller is reused so a
 * Vercel log line and a gateway log line can be joined; otherwise one is
 * generated here.
 */
export function resolveRequestId(req: IncomingMessage): string {
  const header = req.headers["x-request-id"];
  const value = Array.isArray(header) ? header[0] : header;
  if (value && REQUEST_ID_RE.test(value.trim())) return value.trim();
  return `gw_${crypto.randomUUID()}`;
}

export interface RawBody {
  text: string;
  json: unknown;
}

/**
 * Read and parse a JSON body with a hard size cap.
 * `limitBytes` is enforced both from Content-Length and while streaming, so a
 * chunked body cannot slip past it.
 */
export async function readJsonBody(
  req: IncomingMessage,
  limitBytes: number,
  timeoutMs: number
): Promise<RawBody> {
  const contentLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new GatewayError("PAYLOAD_TOO_LARGE", 413, `Request body exceeds ${limitBytes} bytes.`);
  }
  const contentType = String(req.headers["content-type"] ?? "");
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    throw new GatewayError("UNSUPPORTED_MEDIA_TYPE", 415, "Content-Type must be application/json.");
  }

  const chunks: Buffer[] = [];
  let total = 0;

  const text = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new GatewayError("REQUEST_TIMEOUT", 408, "The request body was not received in time."));
      req.destroy();
    }, timeoutMs);
    timer.unref?.();

    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        clearTimeout(timer);
        reject(new GatewayError("PAYLOAD_TOO_LARGE", 413, `Request body exceeds ${limitBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", () => {
      clearTimeout(timer);
      reject(badRequest("The request stream failed."));
    });
  });

  if (!text.trim()) return { text: "", json: null };
  try {
    return { text, json: JSON.parse(text) as unknown };
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload).toString(),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(payload);
}

export interface CorsDecision {
  allowedOrigin: string | null;
  headers: Record<string, string>;
}

/**
 * Strict, opt-in CORS. The default configuration has no allowed origins, in
 * which case no CORS headers are emitted at all — the gateway is meant to be
 * called server-to-server. `*` is never emitted.
 */
export function corsFor(
  req: IncomingMessage,
  allowedOrigins: string[]
): CorsDecision {
  const origin = String(req.headers.origin ?? "");
  if (!origin || allowedOrigins.length === 0) return { allowedOrigin: null, headers: {} };
  if (!allowedOrigins.includes(origin)) return { allowedOrigin: null, headers: {} };
  return {
    allowedOrigin: origin,
    headers: {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-Id",
      "Access-Control-Max-Age": "600",
    },
  };
}

/** Method guard helper. */
export function assertMethod(method: string | undefined, allowed: string[]): void {
  if (!method || !allowed.includes(method)) {
    throw new GatewayError("METHOD_NOT_ALLOWED", 405, `Only ${allowed.join(", ")} is supported here.`);
  }
}
