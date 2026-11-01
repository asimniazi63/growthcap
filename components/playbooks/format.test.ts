import { describe, expect, it } from "vitest";
import { monthLabel, monthOptions, paragraphs, segments } from "./format";

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

describe("segments: bold lead-ins and nothing else", () => {
  it("turns **lead-in** into a bold segment and keeps the rest as text", () => {
    expect(segments("**Repeat rate.** 22.2% ordered again.")).toEqual([
      { text: "Repeat rate.", bold: true },
      { text: " 22.2% ordered again.", bold: false },
    ]);
  });

  it("leaves an unpaired marker, HTML and links as plain text", () => {
    expect(segments("Cost ** is <b>high</b> [x](http://e.com)")).toEqual([{ text: "Cost ** is <b>high</b> [x](http://e.com)", bold: false }]);
  });
});
