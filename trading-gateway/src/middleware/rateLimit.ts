/**
 * In-process fixed-window rate limiting.
 *
 * Deliberately simple and dependency-free: the gateway serves one operator
 * through one Vercel deployment, so a sliding-window store is unnecessary
 * complexity. What matters is that a flood cannot reach Delta — especially on
 * the order routes, where each request is a real-money mutation.
 *
 * Two buckets are checked for every limited route:
 *   - per caller (Vercel egress address, or the forwarded client address when
 *     TRUST_PROXY=true)
 *   - global, at 10x the per-caller limit, so a distributed flood still trips
 *     a ceiling that is far below Delta's own limits
 *
 * Sizing note: legitimate dashboard polling goes through the Vercel server, so
 * read limits must stay comfortably above a few requests per second. Defaults
 * (240 reads / 30 orders per minute) allow 4/s of reads and 1 order per 2 s —
 * far more than the dashboard uses, far less than an accident needs.
 */
import type { IncomingMessage } from "node:http";
import { GatewayError } from "../errors.js";

export type RateLimitClass = "read" | "order";

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  readMax: number;
  orderMax: number;
  globalMultiplier?: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly windowMs: number;
  private readonly limits: Record<RateLimitClass, number>;
  private readonly globalMultiplier: number;

  constructor(options: RateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.limits = { read: options.readMax, order: options.orderMax };
    this.globalMultiplier = options.globalMultiplier ?? 10;
  }

  private hit(key: string, max: number, now: number): Window {
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh: Window = { count: 1, resetAt: now + this.windowMs };
      this.windows.set(key, fresh);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }

  private prune(now: number): void {
    if (this.windows.size < 5000) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  /**
   * Check and consume one unit. Throws GatewayError(RATE_LIMITED, 429) with a
   * Retry-After hint when either bucket is exhausted.
   */
  check(scope: string, limitClass: RateLimitClass, now: number = Date.now()): void {
    const max = this.limits[limitClass];
    this.prune(now);

    const caller = this.hit(`${limitClass}:${scope}`, max, now);
    if (caller.count > max) {
      throw new GatewayError("RATE_LIMITED", 429, "Too many requests. Slow down.", {
        scope: limitClass,
        retryAfterSeconds: Math.max(1, Math.ceil((caller.resetAt - now) / 1000)),
      });
    }

    const global = this.hit(`global:${limitClass}`, max * this.globalMultiplier, now);
    if (global.count > max * this.globalMultiplier) {
      throw new GatewayError("RATE_LIMITED", 429, "Gateway-wide rate limit reached.", {
        scope: limitClass,
        retryAfterSeconds: Math.max(1, Math.ceil((global.resetAt - now) / 1000)),
      });
    }
  }

  /** Test helper. */
  reset(): void {
    this.windows.clear();
  }
}

/**
 * Caller identity for rate limiting. Behind a trusted reverse proxy the
 * forwarded address is used; otherwise the socket address.
 */
export function callerIdentity(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const first = value?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}
