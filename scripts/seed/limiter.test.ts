import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLimiter } from "./limiter.js";

describe("createLimiter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lets the first call through at once and spaces the rest 12 s apart at 5 per minute", async () => {
    const limiter = createLimiter({ perMinute: 5 });
    const start = Date.now();
    const stamps: number[] = [];
    const runs = [0, 1, 2].map(() => limiter.acquire().then(() => stamps.push(Date.now() - start)));
    await vi.advanceTimersByTimeAsync(24_000);
    await Promise.all(runs);
    expect(stamps).toEqual([0, 12_000, 24_000]);
  });

  it("never allows more than 5 calls in any 60 s window", async () => {
    const limiter = createLimiter({ perMinute: 5 });
    const start = Date.now();
    const stamps: number[] = [];
    const runs = Array.from({ length: 12 }, () => limiter.acquire().then(() => stamps.push(Date.now() - start)));
    await vi.advanceTimersByTimeAsync(11 * 12_000);
    await Promise.all(runs);
    for (let i = 0; i + 5 < stamps.length; i++) expect(stamps[i + 5]! - stamps[i]!).toBeGreaterThanOrEqual(60_000);
  });

  it("does not delay a call that arrives after the interval has passed", async () => {
    const limiter = createLimiter({ perMinute: 5 });
    await limiter.acquire();
    await vi.advanceTimersByTimeAsync(30_000);
    const before = Date.now();
    await limiter.acquire();
    expect(Date.now() - before).toBe(0);
  });
});
