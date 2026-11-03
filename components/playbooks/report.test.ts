import { describe, expect, it } from "vitest";
import { parseReport, type ReportParsed } from "./report";

// The write-ups of the Black Friday review, the Retention check and the Monthly business review: a few paragraphs that each start with a
// bold lead-in. The first two samples are the saved runs from 2026-11-01 (the real shapes: a bold title line, a stop or an em dash after
// the lead-in); the third is written to the monthly review's question.

const BFCM = [
  "**Black Friday to Cyber Monday 2025 Review — November 28 to December 1, 2025**",
  "**How the weekend went.** The Black Friday–Cyber Monday weekend delivered $2,083.00 in net sales from 36 orders, up from $555.20 and 8 orders in the prior four days (November 24–27, 2025) — a jump of 275.2% in net sales and 350% in orders.",
  "**Which codes drove orders.** BFCM25 was the dominant code, accounting for 29 orders and $1,513.50 in net sales. Orders without any discount code came second with 4 orders.",
  "**Stock to check before next Black Friday.** Two variants need attention heading into 2026. Lip Tint in Berry (SKU SOL-15C) is completely out of stock with zero days of cover.",
].join("\n\n");

const RETENTION = [
  "**Repeat rate across the last 12 months** — 22.2% of new customers placed a second order within 60 days of their first, based on 409 customers who are fully past their 60-day window; 79 customers are still inside that window and are left out.",
  "**Returning-customer rate and new-customer orders over the last 30 days** — From October 3 to November 1, 2026, the returning-customer rate was 57.9%, up 26.7% from the 45.7% recorded in the prior 30-day period.",
  "**One thing to watch** — The rise in returning-customer rate alongside a drop in new-customer orders suggests the customer mix is shifting toward existing buyers.",
].join("\n\n");

const MONTHLY = [
  "**Against plan.** October finished at $41,200.00 against a target of $45,000.00, a gap of $3,800.00 or 8.4% short.",
  "**The other numbers.** There were 612 orders at an average order value of $67.32, with 190 new-customer orders and a refund rate of 3.1%.",
  "**What drove the gap.** New-customer orders fell the most, and the calendar shows a paid-social budget cut on October 8 (call note, October 9).",
  "**Next month.** Put the saved paid-social budget back for the first two weeks.",
].join("\n\n");

const parse = (text: string): ReportParsed => {
  const parsed = parseReport(text);
  if (!parsed) throw new Error("expected the write-up to parse");
  return parsed;
};

// Every word of the input, in order of sorting, with the bold markers, the stop or dash right after a lead-in, and nothing else taken out.
const words = (text: string) =>
  text
    .replace(/\*\*([^*]+?)(?:[.:])?\*\*\s*(?:[—–-]\s+)?/g, "$1 ")
    .split(/\s+/)
    .filter((w) => w !== "")
    .sort();
const outputWords = (p: ReportParsed) =>
  [p.title ?? "", ...p.sections.flatMap((s) => [s.heading ?? "", ...s.paragraphs])]
    .join(" ")
    .replace(/\*\*/g, "")
    .split(/\s+/)
    .filter((w) => w !== "")
    .sort();

describe("parseReport: the Black Friday review", () => {
  it("reads the bold first line as the title and each lead-in as a section heading", () => {
    const p = parse(BFCM);
    expect(p.title).toBe("Black Friday to Cyber Monday 2025 Review — November 28 to December 1, 2025");
    expect(p.sections.map((s) => s.heading)).toEqual(["How the weekend went", "Which codes drove orders", "Stock to check before next Black Friday"]);
    expect(p.sections[0]!.paragraphs).toEqual([BFCM.split("\n\n")[1]!.replace("**How the weekend went.** ", "")]);
    expect(p.sections[1]!.paragraphs[0]).toMatch(/^BFCM25 was the dominant code/);
  });

  it("marks the last section as the takeaway when its heading is about what to check, watch or do next", () => {
    expect(parse(BFCM).sections.map((s) => s.takeaway)).toEqual([false, false, true]);
  });
});

describe("parseReport: the Retention check", () => {
  it("takes the em dash after a lead-in out of the text, and keeps long lead-ins as headings", () => {
    const p = parse(RETENTION);
    expect(p.title).toBeNull();
    expect(p.sections.map((s) => s.heading)).toEqual([
      "Repeat rate across the last 12 months",
      "Returning-customer rate and new-customer orders over the last 30 days",
      "One thing to watch",
    ]);
    expect(p.sections[0]!.paragraphs[0]).toMatch(/^22\.2% of new customers placed a second order/);
    expect(p.sections[2]!.paragraphs[0]).toMatch(/^The rise in returning-customer rate/);
    expect(p.sections.map((s) => s.takeaway)).toEqual([false, false, true]);
  });
});

describe("parseReport: the Monthly business review", () => {
  it("reads four sections with no title, and marks the Next month one as the takeaway", () => {
    const p = parse(MONTHLY);
    expect(p.title).toBeNull();
    expect(p.sections.map((s) => s.heading)).toEqual(["Against plan", "The other numbers", "What drove the gap", "Next month"]);
    expect(p.sections.map((s) => s.takeaway)).toEqual([false, false, false, true]);
  });

  it("reads a month that is not finished: two sections are enough", () => {
    const two = MONTHLY.split("\n\n").slice(0, 2).join("\n\n");
    expect(parse(two).sections).toHaveLength(2);
  });
});

describe("parseReport: forgiving of how a model writes", () => {
  it("accepts a colon, a plain hyphen or no mark after the bold lead-in", () => {
    const p = parse("**First:** one thing here.\n\n**Second** - another thing here.\n\n**Third** more words straight after.");
    expect(p.sections.map((s) => s.heading)).toEqual(["First", "Second", "Third"]);
    expect(p.sections.map((s) => s.paragraphs[0])).toEqual(["one thing here.", "another thing here.", "more words straight after."]);
  });

  it("adds a paragraph with no lead-in to the section above it, so nothing is dropped", () => {
    const p = parse("**First.** One.\n\nA second paragraph of the first section.\n\n**Second.** Two.");
    expect(p.sections).toHaveLength(2);
    expect(p.sections[0]!.paragraphs).toEqual(["One.", "A second paragraph of the first section."]);
  });

  it("keeps an opening paragraph with no lead-in as an untitled section", () => {
    const p = parse("An opening line with no bold.\n\n**First.** One.\n\n**Second.** Two.");
    expect(p.sections[0]).toEqual({ heading: null, paragraphs: ["An opening line with no bold."], takeaway: false });
    expect(p.sections).toHaveLength(3);
  });

  it("uses a bold line on its own in the middle as the heading of the paragraph below it", () => {
    const p = parse("**First.** One.\n\n**A heading on its own**\n\nThe paragraph under it.\n\n**Third.** Three.");
    expect(p.sections.map((s) => s.heading)).toEqual(["First", "A heading on its own", "Third"]);
    expect(p.sections[1]!.paragraphs).toEqual(["The paragraph under it."]);
  });

  it("keeps a bold phrase inside the text as it is, and treats an overlong bold start as part of the text", () => {
    const p = parse("**First.** One **bold** word.\n\n**Second.** Two.");
    expect(p.sections[0]!.paragraphs[0]).toBe("One **bold** word.");
    const long = `**${"A very long bold opening that runs on and on ".repeat(3).trim()}** and then the rest.`;
    const q = parse(`${long}\n\n**First.** One.\n\n**Second.** Two.`);
    expect(q.sections[0]!.heading).toBeNull();
    expect(q.sections[0]!.paragraphs[0]).toContain("and then the rest.");
  });

  it("drops a paragraph that is only a horizontal rule, and keeps line breaks inside a paragraph", () => {
    const p = parse("**First.** One\nsecond line.\n\n---\n\n**Second.** Two.");
    expect(p.sections).toHaveLength(2);
    expect(p.sections[0]!.paragraphs[0]).toBe("One\nsecond line.");
  });

  it("marks the closing section as the takeaway whatever word the model used for it: priority, recommendation, focus, follow-up", () => {
    // The first real Monthly business review (2026-11-03) closed with "**Priority for November.**".
    for (const heading of ["Priority for November", "Recommendation", "Focus for the holiday peak", "Follow-up", "What to do about it", "Suggested action"]) {
      const p = parse(`**First.** One.\n\n**Second.** Two.\n\n**${heading}.** Do this.`);
      expect(p.sections.map((s) => s.takeaway), heading).toEqual([false, false, true]);
    }
    expect(parse("**First.** One.\n\n**Second.** Two.\n\n**Detail.** Three.").sections.at(-1)!.takeaway).toBe(false);
  });

  it("marks only the last section as the takeaway, even when an earlier heading says next", () => {
    const p = parse("**Next steps.** Do this.\n\n**Numbers.** Here.\n\n**Detail.** There.");
    expect(p.sections.map((s) => s.takeaway)).toEqual([false, false, false]);
  });

  it("loses no word", () => {
    for (const text of [BFCM, RETENTION, MONTHLY, "An opening line.\n\n**First.** One\nsecond line.\n\nLoose.\n\n**Second** - Two."]) {
      expect(outputWords(parse(text)), text.slice(0, 30)).toEqual(words(text));
    }
  });
});

describe("parseReport: a write-up that is not a report returns null, so the page shows plain text", () => {
  it("returns null for nothing, one paragraph, or paragraphs with no lead-ins", () => {
    expect(parseReport("")).toBeNull();
    expect(parseReport("   \n\n  ")).toBeNull();
    expect(parseReport("**Only one.** A single paragraph.")).toBeNull();
    expect(parseReport("Just some prose.\n\nAnd some more prose, with no bold at all.")).toBeNull();
    expect(parseReport("**A title only**\n\n**First.** One.")).toBeNull();
  });
});
