export const ERROR_CODES = [
  "STORE_DISCONNECTED",
  "SHOPIFY_THROTTLED",
  "SHOPIFY_UNAVAILABLE",
  "DATA_STALE",
  "NO_DATA",
  "INVALID_INPUT",
  "MODEL_TIMEOUT",
  "BUDGET_EXCEEDED",
  "INTERNAL_ERROR", // anything unexpected: the user sees a generic message, and the detail stays in the server log
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
