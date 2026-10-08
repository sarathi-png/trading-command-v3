/**
 * Error taxonomy shared by the gateway routes.
 *
 * Every error carries a STABLE machine-readable `code`, an HTTP status and a
 * message that is safe to return over the wire. Anything that could leak a
 * credential, a signature, an authorization header or a stack trace never
 * reaches the caller: `publicError()` strips it to the taxonomy below and the
 * detail stays in the gateway log.
 */

export type ErrorCode =
  // transport / routing
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  // auth
  | "UNAUTHORIZED"
  | "GATEWAY_NOT_CONFIGURED"
  // rate limiting / timeouts
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  // validation
  | "VALIDATION_ERROR"
  | "UNKNOWN_SYMBOL"
  | "SYMBOL_NOT_ALLOWED"
  | "POSITION_NOT_FOUND"
  // risk
  | "RISK_BLOCKED"
  | "LIVE_EXECUTION_DISABLED"
  // ordering / idempotency
  | "DUPLICATE_ORDER"
  | "ORDER_STATUS_UNKNOWN"
  | "IDEMPOTENCY_CONFLICT"
  // delta
  | "DELTA_AUTH_ERROR"
  | "DELTA_FORBIDDEN"
  | "DELTA_RATE_LIMITED"
  | "DELTA_API_ERROR"
  | "DELTA_NOT_FOUND"
  | "DELTA_TIMEOUT"
  | "DELTA_UNAVAILABLE"
  | "DELTA_UNKNOWN_RESULT"
  | "INTERNAL_ERROR";

export interface ErrorDetail {
  /** Extra, NON-SENSITIVE context (never a header, body echo or credential). */
  [key: string]: string | number | boolean | null | undefined;
}

export class GatewayError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: ErrorDetail;

  constructor(code: ErrorCode, status: number, message: string, detail: ErrorDetail = {}) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export const badRequest = (message: string, detail?: ErrorDetail): GatewayError =>
  new GatewayError("BAD_REQUEST", 400, message, detail);

export const validationError = (message: string, detail?: ErrorDetail): GatewayError =>
  new GatewayError("VALIDATION_ERROR", 422, message, detail);

export const unauthorized = (message = "Invalid or missing gateway credentials."): GatewayError =>
  new GatewayError("UNAUTHORIZED", 401, message);

/** Delta answered with an error status: the outcome is KNOWN. */
export const deltaApiError = (
  status: number,
  message: string,
  detail?: ErrorDetail
): GatewayError => new GatewayError("DELTA_API_ERROR", status === 429 ? 429 : 502, message, detail);

/**
 * The request may or may not have reached Delta (timeout, socket reset,
 * connection refused mid-flight). The order outcome is UNKNOWN and the caller
 * must reconcile — never retry blindly.
 */
export const deltaUnknownResult = (message: string, detail?: ErrorDetail): GatewayError =>
  new GatewayError("DELTA_UNKNOWN_RESULT", 502, message, detail);

export interface PublicError {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    detail?: Record<string, string | number | boolean | null>;
  };
}

/**
 * Normalise anything thrown in a handler into the public error envelope.
 *
 * Unknown throwables become a generic INTERNAL_ERROR: their message could
 * contain a URL, a body echo or a stack frame.
 */
export function publicError(err: unknown, requestId: string): { status: number; body: PublicError } {
  if (err instanceof GatewayError) {
    const detail = Object.fromEntries(
      Object.entries(err.detail).filter(([, v]) => v !== undefined)
    ) as Record<string, string | number | boolean | null>;
    return {
      status: err.status,
      body: {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          requestId,
          ...(Object.keys(detail).length > 0 ? { detail } : {}),
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The gateway encountered an unexpected error.",
        requestId,
      },
    },
  };
}
