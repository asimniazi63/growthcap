import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { fallbackReason, shouldFallback } from "./fallback";

const api = (statusCode?: number) => new APICallError({ message: "boom", url: "https://bedrock", requestBodyValues: {}, statusCode });

describe("shouldFallback", () => {
  it("falls back for a timeout, a 5xx, throttling and an unreachable provider", () => {
    for (const s of [500, 502, 503, 504, 429, 408, undefined]) expect(shouldFallback(api(s)), String(s)).toBe(true);
    const timeout = new Error("The operation timed out");
    timeout.name = "TimeoutError";
    expect(shouldFallback(timeout)).toBe(true);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(shouldFallback(abort)).toBe(true);
    expect(shouldFallback(new AppError("MODEL_TIMEOUT", "slow", { retryable: true }))).toBe(true);
    const unavailable = new Error("ServiceUnavailableException: the model is temporarily unavailable");
    expect(shouldFallback(unavailable)).toBe(true);
  });

  it("looks inside a retry error for the real failure", () => {
    expect(shouldFallback({ lastError: api(503) })).toBe(true);
    expect(shouldFallback({ lastError: api(403) })).toBe(false);
  });

  it("never falls back for a client error, a budget, validation or tool error, or anything unknown", () => {
    for (const s of [400, 401, 403, 404, 422]) expect(shouldFallback(api(s)), String(s)).toBe(false);
    expect(shouldFallback(new AppError("BUDGET_EXCEEDED", "over"))).toBe(false);
    expect(shouldFallback(new AppError("INVALID_INPUT", "bad"))).toBe(false);
    expect(shouldFallback(new AppError("INTERNAL_ERROR", "oops"))).toBe(false);
    expect(shouldFallback(new Error("Invalid input for tool: expected number"))).toBe(false);
    expect(shouldFallback("timeout")).toBe(false);
    expect(shouldFallback(null)).toBe(false);
    expect(shouldFallback(undefined)).toBe(false);
  });
});

describe("fallbackReason", () => {
  it("names the cause without the provider's message", () => {
    expect(fallbackReason(api(503))).toBe("http_503");
    expect(fallbackReason(api())).toBe("no_response");
    expect(fallbackReason({ lastError: api(429) })).toBe("http_429");
    const t = new Error("x");
    t.name = "TimeoutError";
    expect(fallbackReason(t)).toBe("timeout");
  });
});
