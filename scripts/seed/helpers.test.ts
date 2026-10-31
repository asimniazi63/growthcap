import { describe, expect, it } from "vitest";
import { makeRng, poisson, weightedIndex } from "./rng.js";
import { addDays, daysBetween, eachDay, localIso, localDate, weekday } from "./time.js";
import { allocate, roundHalfUp } from "./money.js";

describe("rng", () => {
  it("gives the same stream for the same keys and different streams for different keys", () => {
    const a = makeRng(42, "day", "2026-01-01");
    const b = makeRng(42, "day", "2026-01-01");
    const c = makeRng(42, "day", "2026-01-02");
    const sa = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(sa);
    expect([c(), c(), c()]).not.toEqual(sa);
    for (const v of sa) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("poisson has the right mean", () => {
    const r = makeRng(1, "p");
    let sum = 0;
    for (let i = 0; i < 4000; i++) sum += poisson(r, 2.5);
    expect(sum / 4000).toBeGreaterThan(2.35);
    expect(sum / 4000).toBeLessThan(2.65);
  });

  it("weightedIndex never picks a zero weight", () => {
    const r = makeRng(3, "w");
    for (let i = 0; i < 500; i++) expect(weightedIndex(r, [0, 5, 0, 1])).not.toBe(0);
  });
});

describe("time", () => {
  it("does date arithmetic on YYYY-MM-DD strings", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(daysBetween("2026-03-01", "2026-03-08")).toBe(7);
    expect(eachDay("2026-01-30", "2026-02-02")).toEqual(["2026-01-30", "2026-01-31", "2026-02-01", "2026-02-02"]);
    expect(weekday("2026-10-31")).toBe(6); // Saturday
  });

  it("uses the store's UTC offset on that date, across DST changes", () => {
    expect(localIso("America/New_York", "2025-11-01", 23, 30)).toBe("2025-11-01T23:30:00-04:00");
    expect(localIso("America/New_York", "2025-11-02", 12, 0)).toBe("2025-11-02T12:00:00-05:00");
    expect(localIso("America/New_York", "2026-03-08", 12, 0)).toBe("2026-03-08T12:00:00-04:00");
    expect(localIso("America/New_York", "2026-03-07", 12, 0)).toBe("2026-03-07T12:00:00-05:00");
    expect(localIso("America/Los_Angeles", "2026-07-01", 0, 30)).toBe("2026-07-01T00:30:00-07:00");
  });

  it("reads the store-local date back from a processedAt string", () => {
    expect(localDate("2025-09-30T23:30:00-04:00")).toBe("2025-09-30");
  });
});

describe("money", () => {
  it("rounds half up", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.4999)).toBe(2);
  });

  it("allocates a total pro rata, with the remainder on the heaviest line, summing exactly", () => {
    const parts = allocate(100, [3333, 3333, 3334]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(100);
    expect(allocate(0, [500, 700])).toEqual([0, 0]);
    expect(allocate(1000, [2500])).toEqual([1000]);
    const heavy = allocate(7, [1, 1, 10]);
    expect(heavy.reduce((s, x) => s + x, 0)).toBe(7);
  });
});
