import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReportParsed } from "./report";
import { keyFigureSegments, ReportView } from "./report-view";

// The report layout of the Black Friday review, the Retention check and the Monthly business review (layer A of the Playbooks page).
// The view is plain markup, so it runs in plain Node as the Creative briefs view test does.

const FIGURE_SPAN = /<span class="[^"]*tabular-nums[^"]*">([^<]*)<\/span>/g;
const text = (markup: string) =>
  markup
    .replace(FIGURE_SPAN, "$1")
    .replace(/<\/?strong>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const figures = (markup: string) => [...markup.matchAll(FIGURE_SPAN)].map((m) => m[1]);
const count = (haystack: string, needle: RegExp) => (haystack.match(needle) ?? []).length;

const WEEKEND =
  "The Black Friday–Cyber Monday weekend delivered $2,083.00 in net sales from 36 orders, up from $555.20 and 8 orders in the prior four days (November 24–27, 2025) — a jump of 275.2% in net sales and 350% in orders.";

const parsed = (over: Partial<ReportParsed> = {}): ReportParsed => ({
  title: "Black Friday to Cyber Monday 2025 Review — November 28 to December 1, 2025",
  sections: [
    { heading: "How the weekend went", paragraphs: [WEEKEND], takeaway: false },
    { heading: "Which codes drove orders", paragraphs: ["BFCM25 was the dominant code, accounting for 29 orders and $1,513.50 in net sales."], takeaway: false },
    { heading: "Stock to check before next Black Friday", paragraphs: ["Lip Tint in Berry is out of stock with zero days of cover."], takeaway: true },
  ],
  ...over,
});
const html = (p: ReportParsed = parsed()) => renderToStaticMarkup(<ReportView parsed={p} />);

describe("ReportView", () => {
  it("draws one numbered card per headed section in an ordered list, each heading an h3, in the order written", () => {
    const out = html();
    expect(count(out, /<ol /g)).toBe(1);
    expect(count(out, /<li[ >]/g)).toBe(3);
    expect(count(out, /<h3 /g)).toBe(3);
    const t = text(out);
    expect(t).toContain("1 How the weekend went");
    expect(t).toContain("2 Which codes drove orders");
    expect(t.indexOf("How the weekend went")).toBeLessThan(t.indexOf("Which codes drove orders"));
    expect(t.indexOf("Which codes drove orders")).toBeLessThan(t.indexOf("Stock to check before next Black Friday"));
    expect(t).toContain("BFCM25 was the dominant code");
  });

  it("shows the title above the sections, and leaves it out when there is none", () => {
    const t = text(html());
    expect(t).toContain("Black Friday to Cyber Monday 2025 Review — November 28 to December 1, 2025");
    expect(t.indexOf("Review — November")).toBeLessThan(t.indexOf("How the weekend went"));
    expect(text(html(parsed({ title: null })))).not.toContain("Review");
  });

  it("highlights money and percentages only: counts, dates and years stay plain", () => {
    const out = html(parsed({ sections: [{ heading: "How the weekend went", paragraphs: [WEEKEND], takeaway: false }, { heading: "Second", paragraphs: ["x"], takeaway: false }] }));
    expect(figures(out)).toEqual(["$2,083.00", "$555.20", "275.2%", "350%"]);
    expect(text(out)).toContain("36 orders");
    expect(text(out)).toContain("November 24–27, 2025");
  });

  it("draws the closing section as a note with a label for its role, and no other section as one", () => {
    const out = html();
    expect(count(out, /role="note"/g)).toBe(1);
    const note = out.slice(out.indexOf('role="note"'));
    expect(text(note)).toContain("Stock to check before next Black Friday");
    expect(text(note)).toContain("Lip Tint in Berry is out of stock");
    expect(out.slice(0, out.indexOf('role="note"'))).not.toContain("Lip Tint");
    expect(count(html(parsed({ sections: parsed().sections.map((s) => ({ ...s, takeaway: false })) })), /role="note"/g)).toBe(0);
  });

  it("shows an opening paragraph with no heading as plain text above the cards, not as a card", () => {
    const out = html(
      parsed({
        title: null,
        sections: [{ heading: null, paragraphs: ["An opening line."], takeaway: false }, ...parsed().sections.slice(0, 2)],
      }),
    );
    expect(count(out, /<li[ >]/g)).toBe(2);
    expect(out.indexOf("An opening line.")).toBeLessThan(out.indexOf("<ol"));
    expect(text(out)).toContain("1 How the weekend went");
  });

  it("draws every paragraph of a section, and a heading with no paragraph under it as a bare heading", () => {
    const out = html(
      parsed({
        title: null,
        sections: [
          { heading: "One", paragraphs: ["First para.", "Second para."], takeaway: false },
          { heading: "Bare", paragraphs: [], takeaway: false },
        ],
      }),
    );
    expect(count(out, /<p /g)).toBe(2);
    expect(text(out)).toContain("Bare");
    expect(out).toContain("whitespace-pre-line");
  });

  it("turns a bold phrase inside the text into bold, with no ** left over, and highlights a figure inside it", () => {
    const out = html(
      parsed({
        title: null,
        sections: [
          { heading: "One", paragraphs: ["It was **up 26.7%** on the month."], takeaway: false },
          { heading: "Two", paragraphs: ["Plain."], takeaway: false },
        ],
      }),
    );
    expect(out).not.toContain("**");
    expect(out).toMatch(/<strong>[^<]*<span class="[^"]*tabular-nums[^"]*">26\.7%<\/span><\/strong>/);
  });

  it("writes model text as text: markup in it is escaped, never drawn", () => {
    const out = html(
      parsed({
        title: "<img src=x onerror=alert(1)>",
        sections: [
          { heading: "<b>Heading</b>", paragraphs: ["<script>alert(1)</script> and <b>x</b>"], takeaway: false },
          { heading: "Two", paragraphs: ["ok"], takeaway: false },
        ],
      }),
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
    expect(out).toContain("&lt;script&gt;");
  });
});

describe("keyFigureSegments", () => {
  const found = (s: string) => keyFigureSegments(s).filter((p) => p.figure).map((p) => p.text);

  it("marks money and percentages, and joins back to the text it was given", () => {
    const sample = "Net sales were $41,200.00 against $45,000.00, 8.4% short; up 26.7%, then 350% more, and $5 off.";
    expect(found(sample)).toEqual(["$41,200.00", "$45,000.00", "8.4%", "26.7%", "350%", "$5"]);
    expect(keyFigureSegments(sample).map((p) => p.text).join("")).toBe(sample);
    expect(keyFigureSegments("")).toEqual([]);
    expect(keyFigureSegments("no figures here")).toEqual([{ text: "no figures here", figure: false }]);
  });

  it("leaves counts, dates, years and codes alone, and keeps a list comma or stop out of the figure", () => {
    expect(found("36 orders from 409 customers in 2026, on October 3 to November 1; Q4 and SKU-123 and 50ml")).toEqual([]);
    expect(found("Money $2,083.00, then $555.20. And 18.4%, and 5.7%.")).toEqual(["$2,083.00", "$555.20", "18.4%", "5.7%"]);
    expect(keyFigureSegments("Money $2,083, then")).toEqual([
      { text: "Money ", figure: false },
      { text: "$2,083", figure: true },
      { text: ", then", figure: false },
    ]);
  });
});
