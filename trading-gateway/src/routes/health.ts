/**
 * Liveness and readiness.
 *
 * Both are unauthenticated so a load balancer, systemd or Docker healthcheck
 * can use them, and both are deliberately terse: no configuration values, no
 * credential state, no infrastructure detail. `/ready` reports whether the
 * gateway is correctly configured — for an authenticated caller it also lists
 * the NAMES of missing variables (never their values) so a misconfiguration is
 * diagnosable from Vercel without shelling into the box.
 */
import { describeConfig } from "../config.js";
import type { RouteContext, RouteResult } from "../context.js";
import { bearerFrom, constantTimeEqual } from "../auth/gatewayAuth.js";

const startedAt = Date.now();

export function handleHealth(ctx: RouteContext): RouteResult {
  return {
    status: 200,
    body: {
      success: true,
      ok: true,
      service: "trading-command-gateway",
      version: "1.0.0",
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      requestId: ctx.requestId,
    },
  };
}

export function handleReady(ctx: RouteContext): RouteResult {
  const summary = describeConfig(ctx.config);
  const presented = bearerFrom(ctx.req.headers.authorization);
  const authenticated = Boolean(
    presented && ctx.config.gatewaySecret && constantTimeEqual(presented, ctx.config.gatewaySecret)
  );

  return {
    status: summary.ready ? 200 : 503,
    body: {
      success: true,
      ready: summary.ready,
      // Booleans and counts are safe unauthenticated; names are not, because
      // they tell an unauthenticated prober which secret to attack.
      missingConfigCount: summary.missing.length,
      liveExecutionEnabled: summary.liveExecutionEnabled,
      deltaBaseHost: summary.deltaBaseHost,
      ...(authenticated ? { missing: summary.missing, present: summary.present } : {}),
      requestId: ctx.requestId,
    },
  };
}
