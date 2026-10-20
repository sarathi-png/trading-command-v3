/**
 * Validation and normalization for TradingView alert payloads.
 *
 * TradingView alert bodies are user-authored JSON templates, so the same field
 * can arrive as a number or a string (`"price": "108000"`), a symbol can carry
 * an exchange prefix (`BINANCE:BTCUSD`), and `{{interval}}` is emitted as
 * `1/5/15/60/240/D/W` rather than the app's timeframe labels.
 *
 * The rule here is: normalize what has exactly one honest interpretation, and
 * reject everything else. In particular a missing or unparseable price is never
 * stored as `0` — a fabricated price in the signal inbox is worse than a
 * refused alert.
 */

// Relative import: `npm run test:safety` compiles with tsc and runs the output
// under plain Node, which does not rewrite the `@/` path alias. Type-only `@/`
// imports are erased and safe, but this module needs `TIMEFRAMES` at runtime.
import { TIMEFRAMES, type Timeframe } from "../../types";

export type AlertAction = "LONG" | "SHORT" | "CLOSE" | "WATCH";

export interface TradingViewAlert {
  symbol: string;
  action: AlertAction;
  timeframe: Timeframe;
  /** Real alert price. Always finite and positive. */
  price: number;
  /** Defaults to `price`: the alert fired at this price. */
  entry: number;
  stop: number | null;
  target: number | null;
  strategy: string;
  message: string;
  timestamp: number;
}

export type AlertParseResult =
  | { ok: true; alert: TradingViewAlert }
  | { ok: false; error: string };

/** Timestamp freshness window, mirrored from the original route. */
export const ALERT_MAX_AGE_MS = 5 * 60_000;

/** TradingView `{{interval}}` and the app's timeframe labels. */
const INTERVAL_TIMEFRAMES: Record<string, Timeframe> = {
  "1": "1m",
  "3": "3m",
  "5": "5m",
  "15": "15m",
  "30": "30m",
  "60": "1H",
  "120": "2H",
  "240": "4H",
  "D": "1D",
  "1D": "1D",
  "W": "1W",
  "1W": "1W",
};

const SYMBOL_PATTERN = /^[A-Z0-9._-]{2,30}$/;
const ACTIONS: AlertAction[] = ["LONG", "SHORT", "CLOSE", "WATCH"];
const MAX_STRATEGY_LENGTH = 64;
const MAX_MESSAGE_LENGTH = 500;
const DEFAULT_MESSAGE = "External TradingView alert (validated)";

/**
 * Read an optional positive number.
 *
 * - absent (undefined/null/blank string) → `null`
 * - number or numeric string, finite and > 0 → the number
 * - anything else → `undefined` (invalid; the caller must reject)
 */
function optionalPositive(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

/** `BINANCE:BTCUSD` → `BTCUSD`. Only a leading exchange alias is stripped. */
function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const upper = raw.trim().toUpperCase();
  const withoutExchange = upper.includes(":") ? upper.slice(upper.lastIndexOf(":") + 1) : upper;
  return SYMBOL_PATTERN.test(withoutExchange) ? withoutExchange : null;
}

function normalizeTimeframe(raw: unknown): Timeframe | null {
  if (raw === undefined || raw === null || raw === "") return "15m";
  const value = String(raw).trim();
  // App labels are case-sensitive ("15m" vs "1H"), so try the value as given
  // before the upper-cased TradingView interval form.
  if ((TIMEFRAMES as string[]).includes(value)) return value as Timeframe;
  const upper = value.toUpperCase();
  if ((TIMEFRAMES as string[]).includes(upper)) return upper as Timeframe;
  return INTERVAL_TIMEFRAMES[upper] ?? null;
}

function normalizeStrategy(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  const sanitized = text.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, MAX_STRATEGY_LENGTH);
  return sanitized || "external";
}

function normalizeMessage(raw: unknown): string {
  const text = typeof raw === "string" && raw.trim() ? raw.trim() : DEFAULT_MESSAGE;
  return text.slice(0, MAX_MESSAGE_LENGTH);
}

function parseTimestamp(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Validate an alert body.
 *
 * @param body Parsed JSON request body.
 * @param now  Clock injection point for tests.
 */
export function parseTradingViewAlert(
  body: unknown,
  now: number = Date.now()
): AlertParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Payload must be a JSON object" };
  }
  const input = body as Record<string, unknown>;

  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) {
    return { ok: false, error: "symbol must be 2-30 chars of A-Z, 0-9, '.', '_' or '-'" };
  }

  const action = String(input.action ?? "").trim().toUpperCase() as AlertAction;
  if (!ACTIONS.includes(action)) {
    return { ok: false, error: "action must be LONG, SHORT, CLOSE or WATCH" };
  }

  const timestamp = parseTimestamp(input.timestamp ?? input.ts);
  if (timestamp === null) {
    return { ok: false, error: "timestamp is required (epoch ms or ISO date)" };
  }
  if (Math.abs(now - timestamp) > ALERT_MAX_AGE_MS) {
    return { ok: false, error: "Stale or missing timestamp" };
  }

  const timeframe = normalizeTimeframe(input.timeframe ?? input.interval);
  if (!timeframe) {
    return {
      ok: false,
      error: `Unsupported timeframe "${String(input.timeframe ?? input.interval)}". Use a TradingView interval (1,3,5,15,30,60,120,240,D,W) or one of ${TIMEFRAMES.join(", ")}.`,
    };
  }

  // A signal without a real price cannot be shown or traded honestly, so every
  // action requires one (including WATCH).
  const price = optionalPositive(input.price);
  if (price === undefined) {
    return { ok: false, error: "price must be a positive number" };
  }
  if (price === null) {
    return { ok: false, error: "price is required (include {{close}} in the alert)" };
  }

  const entryRaw = optionalPositive(input.entry);
  const stop = optionalPositive(input.stop);
  const target = optionalPositive(input.target);
  if (entryRaw === undefined) return { ok: false, error: "entry must be a positive number when present" };
  if (stop === undefined) return { ok: false, error: "stop must be a positive number when present" };
  if (target === undefined) return { ok: false, error: "target must be a positive number when present" };

  return {
    ok: true,
    alert: {
      symbol,
      action,
      timeframe,
      price,
      entry: entryRaw ?? price,
      stop,
      target,
      strategy: normalizeStrategy(input.strategy),
      message: normalizeMessage(input.message),
      timestamp,
    },
  };
}
