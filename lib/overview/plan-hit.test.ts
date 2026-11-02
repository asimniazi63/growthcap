import { describe, expect, it } from "vitest";
import { firstSightThisSession, isPlanHit, planHitKey, planHitLabel, type SessionStore } from "./plan-hit";

const gap = (over: Partial<Parameters<typeof isPlanHit>[0] & object> = {}) => ({ target: 1_000_000, actual: 400_000, ...over });

describe("isPlanHit", () => {
  it("is true when the gap says the target is met", () => {
    expect(isPlanHit(gap({ actual: 1_000_000, targetMet: true }))).toBe(true);
  });

  it("is true when the actual has reached or passed the target even without the flag", () => {
    expect(isPlanHit(gap({ actual: 1_000_000 }))).toBe(true);
    expect(isPlanHit(gap({ actual: 1_250_000 }))).toBe(true);
  });

  it("is false when the target is not met, even if the month is ahead of the plan to date", () => {
    expect(isPlanHit(gap({ actual: 999_999 }))).toBe(false);
    expect(isPlanHit(gap({ actual: 400_000, targetMet: undefined }))).toBe(false);
  });

  it("is false with no gap, and with no real target to hit", () => {
    expect(isPlanHit(undefined)).toBe(false);
    expect(isPlanHit(null)).toBe(false);
    expect(isPlanHit(gap({ target: 0, actual: 500 }))).toBe(false);
  });
});

describe("planHitLabel", () => {
  it("names the month", () => {
    expect(planHitLabel("2026-10")).toBe("Plan hit for October");
    expect(planHitLabel("2027-01")).toBe("Plan hit for January");
  });
});

function memoryStore(): SessionStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe("firstSightThisSession", () => {
  it("is true once per key, then false", () => {
    const store = memoryStore();
    const key = planHitKey("tenant-a", "2026-10");
    expect(firstSightThisSession(store, key)).toBe(true);
    expect(firstSightThisSession(store, key)).toBe(false);
    expect(firstSightThisSession(store, key)).toBe(false);
  });

  it("treats another brand or another month as a new sight", () => {
    const store = memoryStore();
    expect(firstSightThisSession(store, planHitKey("tenant-a", "2026-10"))).toBe(true);
    expect(firstSightThisSession(store, planHitKey("tenant-b", "2026-10"))).toBe(true);
    expect(firstSightThisSession(store, planHitKey("tenant-a", "2026-11"))).toBe(true);
  });

  it("does not play when storage is missing, blocked or full", () => {
    expect(firstSightThisSession(null, "k")).toBe(false);
    const blocked: SessionStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    expect(firstSightThisSession(blocked, "k")).toBe(false);
    const full: SessionStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(firstSightThisSession(full, "k")).toBe(false);
  });
});
