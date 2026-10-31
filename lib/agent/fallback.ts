import { APICallError } from "ai";
import { AppError } from "../errors";

// Decides whether a failed model call is worth one retry on the fallback model. Only trouble on the model's side qualifies:
// a timeout, a 5xx, throttling, or a provider that says it is unavailable. A budget, validation or tool error, and anything
// we don't recognise, never does (a different model would only repeat or hide the problem).

const UNAVAILABLE_NAMES = new Set(["ServiceUnavailableException", "ModelTimeoutException", "ModelNotReadyException", "InternalServerException", "ThrottlingException", "TimeoutError", "AbortError"]);
const UNAVAILABLE_TEXT = /\b(service unavailable|temporarily unavailable|overloaded|timed? ?out|gateway time-?out|bad gateway|econnreset|etimedout|socket hang up)\b/i;

export function shouldFallback(error: unknown, depth = 0): boolean {
  if (error === null || error === undefined || depth > 3) return false;
  // The AI SDK wraps repeated failures in a RetryError whose last error is the real one.
  const inner = (error as { lastError?: unknown }).lastError;
  if (inner) return shouldFallback(inner, depth + 1);
  if (error instanceof AppError) return error.code === "MODEL_TIMEOUT";
  if (APICallError.isInstance(error)) {
    const s = error.statusCode;
    if (s === undefined) return true; // no response at all: the network or the provider is down
    return s >= 500 || s === 429 || s === 408;
  }
  if (error instanceof Error) {
    if (UNAVAILABLE_NAMES.has(error.name)) return true;
    return error.name !== "ZodError" && !/validation|invalid|budget/i.test(error.name) && UNAVAILABLE_TEXT.test(error.message);
  }
  return false;
}

// The short reason recorded in the audit row, never the provider's own message.
export function fallbackReason(error: unknown): string {
  const inner = (error as { lastError?: unknown } | null)?.lastError;
  if (inner) return fallbackReason(inner);
  if (APICallError.isInstance(error)) return error.statusCode === undefined ? "no_response" : `http_${error.statusCode}`;
  if (error instanceof AppError) return error.code.toLowerCase();
  if (error instanceof Error) return error.name === "TimeoutError" || error.name === "AbortError" ? "timeout" : "unavailable";
  return "unavailable";
}
