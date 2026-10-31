import { afterEach, describe, expect, it } from "vitest";
import { setTestNow, storeToday } from "./clock";

const NY = "America/New_York";
const LA = "America/Los_Angeles";

afterEach(() => setTestNow(null));

describe("storeToday", () => {
  it("uses the store-local date of now, not the UTC date", () => {
    setTestNow("2026-03-06T03:30:00Z"); // 22:30 on 03-05 in New York
    expect(storeToday(NY, null)).toBe("2026-03-05");
  });

  it("uses now when the newest order is fresh (36 hours old or less)", () => {
    setTestNow("2026-03-07T12:00:00-05:00");
    expect(storeToday(NY, "2026-03-06T00:00:00-05:00")).toBe("2026-03-07"); // exactly 36 hours
  });

  it("uses the newest order's date once it is more than 36 hours old", () => {
    setTestNow("2026-03-07T12:01:00-05:00");
    expect(storeToday(NY, "2026-03-06T00:00:00-05:00")).toBe("2026-03-06");
  });

  it("gives a 2-day-old newest order's date as today", () => {
    setTestNow("2026-03-07T12:00:00-05:00");
    expect(storeToday(NY, "2026-03-05T12:00:00-05:00")).toBe("2026-03-05");
  });

  it("keeps an order at 23:30 New York time on that local day, though UTC has moved on", () => {
    setTestNow("2026-03-10T12:00:00Z");
    // 23:30 on 03-05 in New York is 04:30 UTC on 03-06
    expect(storeToday(NY, "2026-03-05T23:30:00-05:00")).toBe("2026-03-05");
  });

  it("is right on the fall-back day (2025-11-02, UTC-4 turns into UTC-5)", () => {
    setTestNow("2025-11-03T04:30:00Z"); // 23:30 EST
    expect(storeToday(NY, null)).toBe("2025-11-02");
    setTestNow("2025-11-02T05:30:00Z"); // 01:30 EDT, before the change
    expect(storeToday(NY, null)).toBe("2025-11-02");
  });

  it("is right on the spring-forward day (2026-03-08, UTC-5 turns into UTC-4)", () => {
    setTestNow("2026-03-09T03:30:00Z"); // 23:30 EDT
    expect(storeToday(NY, null)).toBe("2026-03-08");
    setTestNow("2026-03-08T06:30:00Z"); // 01:30 EST, before the change
    expect(storeToday(NY, null)).toBe("2026-03-08");
  });

  it("handles Los Angeles in summer and in winter", () => {
    setTestNow("2026-06-15T06:30:00Z"); // 23:30 PDT on 06-14
    expect(storeToday(LA, null)).toBe("2026-06-14");
    setTestNow("2026-01-15T07:30:00Z"); // 23:30 PST on 01-14
    expect(storeToday(LA, null)).toBe("2026-01-14");
  });

  it("goes back to the system clock when the pin is cleared", () => {
    setTestNow("1999-12-31T12:00:00Z");
    expect(storeToday(NY, null)).toBe("1999-12-31");
    setTestNow(null);
    const today = storeToday(NY, null);
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today).not.toBe("1999-12-31");
  });
});
