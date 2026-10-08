/**
 * Structured, secret-scrubbing logger.
 *
 * Two independent layers keep credentials out of the log:
 *
 *  1. Fields with a sensitive name (api-key, signature, authorization,
 *     password, secret, token, cookie ...) are dropped by name.
 *  2. Every serialised line is additionally scrubbed of the literal secret
 *     VALUES the process holds (Delta API secret, Delta API key, gateway
 *     secret). Even if a secret ends up in an unexpected field — a URL, an
 *     error message, a nested object — it cannot be written out.
 *
 * Output is one JSON object per line, which is trivial to ship to journald,
 * Docker logs or a log aggregator.
 */
import type { LogLevel } from "./config.js";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const SENSITIVE_KEY = /(secret|api[-_]?key|apikey|signature|authorization|auth|password|token|cookie|credential)/i;

/**
 * Values registered here are redacted from EVERY log line, whatever key they
 * appear under. Populated once at startup from the loaded configuration.
 */
const secretValues = new Set<string>();

export function registerSecretValues(values: (string | undefined)[]): void {
  for (const value of values) {
    // Short values are skipped: a 1–2 char "secret" would redact half the log.
    if (typeof value === "string" && value.length >= 6) secretValues.add(value);
  }
}

export function scrubSecrets(input: string): string {
  let out = input;
  for (const secret of secretValues) {
    if (secret && out.includes(secret)) out = out.split(secret).join("[redacted]");
  }
  return out;
}

function sanitiseValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubSecrets(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: scrubSecrets(value.message) };
  }
  if (Array.isArray(value)) {
    return depth > 4 ? "[truncated]" : value.slice(0, 50).map((v) => sanitiseValue(v, depth + 1));
  }
  if (typeof value === "object") {
    if (depth > 4) return "[truncated]";
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitiseValue(nested, depth + 1);
    }
    return out;
  }
  return String(value);
}

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  /** Test hook: capture emitted lines instead of writing to stdout. */
  child(sink?: (line: string) => void): Logger;
}

export function createLogger(level: LogLevel = "info", sink?: (line: string) => void): Logger {
  const write = (eventLevel: LogLevel, event: string, fields?: Record<string, unknown>): void => {
    if (LEVEL_ORDER[eventLevel] < LEVEL_ORDER[level]) return;
    const record = {
      ts: new Date().toISOString(),
      level: eventLevel,
      event,
      ...(sanitiseValue(fields ?? {}) as Record<string, unknown>),
    };
    const line = scrubSecrets(JSON.stringify(record));
    if (sink) sink(line);
    else process.stdout.write(`${line}\n`);
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    child: (childSink) => createLogger(level, childSink ?? sink),
  };
}
