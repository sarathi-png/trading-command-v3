/**
 * CoinDCX futures websockets — deliberately NOT wired into the app.
 *
 * The venue's docs recommend its futures socket for live order books and
 * trades, and this module records exactly why the deployed application does not
 * use it, so the decision is reviewable instead of looking like an oversight:
 *
 *   1. The app runs on Vercel, which executes short-lived serverless
 *      functions. A websocket needs a process that stays alive; there is
 *      nowhere to put one without adding a server (and therefore a host to pay
 *      for and secure) — the exact architecture this migration removes.
 *   2. A browser-side socket would mean the user's tab talking to the venue
 *      directly. That is a data-exfiltration surface for no functional gain,
 *      because the dashboard polls REST anyway.
 *   3. Everything the UI needs is available over REST with short TTL caching
 *      (see market.ts), which is what the paper engine and the charts consume.
 *
 * The public API below is the honest surface of that decision: capability
 * reporting plus the URL a future streaming worker (a cron-triggered collector,
 * a queue consumer, or a separate process the operator chooses to run) should
 * connect to. It performs no network I/O, so importing it anywhere is free.
 */

export const COINDCX_FUTURES_SOCKET_URL = "wss://stream.coindcx.com";

export interface StreamingStatus {
  supported: boolean;
  /** Always false here: no long-running process is provisioned by this build. */
  enabled: false;
  socketUrl: string;
  reason: string;
}

export function streamingStatus(): StreamingStatus {
  return {
    supported: false,
    enabled: false,
    socketUrl: COINDCX_FUTURES_SOCKET_URL,
    reason:
      "Websocket streaming requires a long-lived process, which the Vercel-only deployment does not have. " +
      "Market data is polled over CoinDCX REST instead (exchange/coindcx/market.ts).",
  };
}
