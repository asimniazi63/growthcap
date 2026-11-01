import { describe, expect, it } from "vitest";
import { monthLabel, monthOptions, paragraphs } from "./format";

describe("monthOptions: the months the monthly review offers", () => {
  it("starts with Last month (no param), then the five months before it", () => {
    expect(monthOptions(new Date("2026-11-02T10:00:00Z"))).toEqual([
      { value: "", label: "Last month" },
      { value: "2026-09", label: "September 2026" },
      { value: "2026-08", label: "August 2026" },
      { value: "2026-07", label: "July 2026" },
      { value: "2026-06", label: "June 2026" },
      { value: "2026-05", label: "May 2026" },
    ]);
  });

  it("crosses the year boundary", () => {
    expect(monthOptions(new Date("2026-02-01T00:00:00Z"), 4).map((o) => o.value)).toEqual(["", "2025-12", "2025-11", "2025-10"]);
  });
});

describe("monthLabel and paragraphs", () => {
  it("names a YYYY-MM month and leaves anything else alone", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("soon")).toBe("soon");
  });

  it("splits a write-up on blank lines and drops empty ones", () => {
    expect(paragraphs("One.\nStill one.\n\n  \n\nTwo.\r\n\r\nThree. ")).toEqual(["One.\nStill one.", "Two.", "Three."]);
    expect(paragraphs("  ")).toEqual([]);
  });
});
