import { describe, expect, it } from "vitest";
import { dayWeights, landing, shareThrough } from "./shape";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("dayWeights", () => {
  it("spreads evenly when there is no pattern from last year", () => {
    const w = dayWeights(30, null);
    expect(w).toHaveLength(30);
    expect(w.every((x) => Math.abs(x - 1 / 30) < 1e-12)).toBe(true);
  });

  it("spreads evenly when last year's month had no sales at all, or only refunds", () => {
    expect(dayWeights(30, Array(30).fill(0))[0]).toBeCloseTo(1 / 30, 12);
    expect(dayWeights(30, Array(30).fill(-5))[0]).toBeCloseTo(1 / 30, 12);
  });

  it("follows last year's pattern and always adds up to 1", () => {
    const lastYear = [...Array(27).fill(10), 100, 100, 50]; // a Black Friday-style burst at the end of a 30-day month
    const w = dayWeights(30, lastYear);
    expect(sum(w)).toBeCloseTo(1, 12);
    expect(w[28]! / w[0]!).toBeCloseTo(10, 9);
  });

  it("makes the month-to-date plan small before the burst, not a straight line (the November case)", () => {
    const lastYear = [...Array(27).fill(10), 100, 100, 50];
    const w = dayWeights(30, lastYear);
    const uniformShare = 20 / 30;
    expect(shareThrough(w, 1, 20)).toBeCloseTo(200 / 520, 12);
    expect(shareThrough(w, 1, 20)).toBeLessThan(uniformShare);
  });

  it("treats a day with a refund bigger than its sales as a day with nothing, not as a negative share", () => {
    const w = dayWeights(3, [10, -4, 10]);
    expect(w).toEqual([0.5, 0, 0.5]);
  });

  it("copes with a month of a different length: a missing day gets the average day, an extra day is dropped", () => {
    const feb = Array(28).fill(10);
    const march = dayWeights(31, feb);
    expect(march).toHaveLength(31);
    expect(sum(march)).toBeCloseTo(1, 12);
    expect(march[30]).toBeCloseTo(1 / 31, 12);
    const longer = dayWeights(28, Array(31).fill(10));
    expect(longer).toHaveLength(28);
    expect(sum(longer)).toBeCloseTo(1, 12);
  });
});

describe("shareThrough", () => {
  const w = dayWeights(10, [1, 1, 1, 1, 1, 1, 1, 1, 1, 11]);
  it("is 1 for the whole month and 0 for none of it", () => {
    expect(shareThrough(w, 1, 10)).toBeCloseTo(1, 12);
    expect(shareThrough(w, 5, 4)).toBe(0);
  });
  it("counts both ends of the range", () => {
    expect(shareThrough(w, 10, 10)).toBeCloseTo(11 / 20, 12);
    expect(shareThrough(w, 1, 1)).toBeCloseTo(1 / 20, 12);
  });
  it("clamps days outside the month", () => {
    expect(shareThrough(w, -3, 99)).toBeCloseTo(1, 12);
  });
});

describe("landing", () => {
  it("is what has happened plus the rest of the plan scaled by how the month has gone so far", () => {
    // plan so far 400, plan for the rest 600, actual so far 300: 300 + 600 x 0.75
    expect(landing(300, 400, 600)).toBe(750);
  });
  it("lands on the target when exactly on plan, above it when ahead and below it when behind", () => {
    expect(landing(400, 400, 600)).toBe(1000);
    expect(landing(500, 400, 600)).toBeGreaterThan(1000);
    expect(landing(200, 400, 600)).toBeLessThan(1000);
  });
  it("is not known before any of the plan has come due", () => {
    expect(landing(0, 0, 1000)).toBeNull();
    expect(landing(5, 0, 1000)).toBeNull();
  });
  it("is just what has happened when nothing is left to plan", () => {
    expect(landing(300, 400, 0)).toBe(300);
  });
});
