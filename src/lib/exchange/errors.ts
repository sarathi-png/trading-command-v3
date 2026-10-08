/**
 * Normalised exchange errors.
 *
 * Every failure the application sees carries a machine-readable code and a
 * message that is safe to show a user or write to a log. The venue's status
 * code, its error string and our own correlation id travel in `detail`; API
 * secrets, signatures and authorization headers never do.
 */
export type ExchangeErrorCode =
  /** No credentials configured on this deployment (fail closed). */
  | "EXCHANGE_NOT_CONFIGURED"
  /** Venue rejected the key/signature (401-equivalent). */
  | "EXCHANGE_AUTH_ERROR"
  /** Venue accepted the key but denied the operation (perm/IP/allowlist). */
  | "EXCHANGE_FORBIDDEN"
  /** Unknown instrument, order or position. */
  | "EXCHANGE_NOT_FOUND"
  /** Rate limited by the venue. */
  | "EXCHANGE_RATE_LIMITED"
  /** Network/DNS/TLS failure or non-JSON answer. */
  | "EXCHANGE_UNAVAILABLE"
  /** Request timed out. */
  | "EXCHANGE_TIMEOUT"
  /** Venue answered 4xx with a business error (validation, margin, …). */
  | "EXCHANGE_BAD_REQUEST"
  /** Venue answered 5xx. */
  | "EXCHANGE_API_ERROR"
  /**
   * A mutation was submitted and the outcome is NOT known (timeout, socket
   * error, 5xx after send). The caller must reconcile — never resubmit.
   */
  | "EXCHANGE_UNKNOWN_RESULT"
  /** The configured venue does not support this operation. */
  | "EXCHANGE_NOT_SUPPORTED";

export interface ExchangeErrorDetail {
  exchange?: string;
  path?: string;
  /** HTTP status from the venue, when there was a response at all. */
  status?: number;
  /** Venue error code/message, already credential-free. */
  venueCode?: string;
  /** Our correlation id (ties to the audit log). */
  requestId?: string;
  [key: string]: unknown;
}

export class ExchangeError extends Error {
  constructor(
    message: string,
    public readonly code: ExchangeErrorCode,
    public readonly status: number,
    public readonly detail: ExchangeErrorDetail = {}
  ) {
    super(message);
    this.name = "ExchangeError";
  }

  /** Safe for the browser: code, message and correlation id only. */
  toSafeJSON(): { success: false; error: { code: ExchangeErrorCode; message: string; requestId?: string } } {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.detail.requestId ? { requestId: String(this.detail.requestId) } : {}),
      },
    };
  }

  /**
   * True when a READ may be retried. Mutations must never use this: an
   * uncertain submission has to be reconciled, not repeated.
   */
  get retryableRead(): boolean {
    return this.code === "EXCHANGE_TIMEOUT" || this.code === "EXCHANGE_UNAVAILABLE" || this.code === "EXCHANGE_RATE_LIMITED";
  }
}

/** Was this failure raised before anything left the process? */
export function isPreSendError(error: unknown): boolean {
  return (
    error instanceof ExchangeError &&
    (error.code === "EXCHANGE_NOT_CONFIGURED" || error.code === "EXCHANGE_NOT_SUPPORTED")
  );
}

/**
 * After an order submission failed, is the venue's state KNOWN to be
 * "no order created"?
 *
 *   - nothing was sent at all (unconfigured / unsupported request)
 *   - the venue answered and refused (4xx: validation, margin, permission, auth)
 *
 * These are safe to report as a plain failure. Everything else — timeout,
 * connection drop, 5xx, rate limit during a write — is UNKNOWN and must go
 * through reconciliation before any retry, because the order may exist.
 */
export function orderOutcomeKnown(error: unknown): boolean {
  if (isPreSendError(error)) return true;
  return (
    error instanceof ExchangeError &&
    (error.code === "EXCHANGE_BAD_REQUEST" ||
      error.code === "EXCHANGE_FORBIDDEN" ||
      error.code === "EXCHANGE_AUTH_ERROR" ||
      error.code === "EXCHANGE_NOT_FOUND")
  );
}
