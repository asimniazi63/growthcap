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

// RULES forbids horizontal rules in a write-up, but the passing live run of the Creative briefs (2026-11-03) put a "---" between its
// briefs. The page shows each paragraph as text, so a rule would show as a line of dashes: it is dropped, and only a rule.
describe("paragraphs: a horizontal rule is dropped", () => {
  it("disappears from between two paragraphs, whatever its line ending", () => {
    expect(paragraphs("One.\n\n---\n\nTwo.")).toEqual(["One.", "Two."]);
    expect(paragraphs("One.\r\n\r\n---\r\n\r\nTwo.")).toEqual(["One.", "Two."]);
    expect(paragraphs("**Brief one**\nWho: the champions.\n\n---\n\n**Brief two**\nWho: the at-risk customers.\n\n---\n\n**Last year.** A paragraph.")).toEqual([
      "**Brief one**\nWho: the champions.",
      "**Brief two**\nWho: the at-risk customers.",
      "**Last year.** A paragraph.",
    ]);
  });

  it("is dropped when it is three or more dashes, asterisks or underscores, with or without spaces between and around", () => {
    for (const rule of ["---", "-----", "----------------", "***", "******", "___", "_____", "- - -", "* * *", "_ _ _", "-- --", "  ---  ", "---   ", "\t---"]) {
      expect(paragraphs(`One.\n\n${rule}\n\nTwo.`), JSON.stringify(rule)).toEqual(["One.", "Two."]);
    }
  });

  it("is dropped at the start or the end of a write-up, and a write-up of nothing else is empty", () => {
    expect(paragraphs("---\n\nOne.")).toEqual(["One."]);
    expect(paragraphs("One.\n\n---")).toEqual(["One."]);
    expect(paragraphs("---")).toEqual([]);
    expect(paragraphs("---\n\n***\n\n___")).toEqual([]);
  });

  it("is not dropped from a paragraph that merely contains dashes, asterisks or underscores", () => {
    for (const keep of ["a - b", "-- note", "--", "-", "- - a", "---x", "--- note", "*** note", "-*-", "- a list item", "**Bold** lead-in", "a---b", "snake_case___name", "$5 - $10"]) {
      expect(paragraphs(`One.\n\n${keep}\n\nTwo.`), keep).toEqual(["One.", keep, "Two."]);
    }
  });

  it("is not dropped when it is a line inside a paragraph: only a paragraph that is a rule goes", () => {
    expect(paragraphs("One.\n---\nStill one.")).toEqual(["One.\n---\nStill one."]);
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
