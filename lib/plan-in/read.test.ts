import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPages, readPlanSheet, verifyClaims } from "./read";
import { pdfPages } from "./store";
import { MADE_UP_CLAIM, SOLENNE_PASS1, SOLENNE_PASS2, scriptedReader } from "./test-support";

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/solenne/${name}`, import.meta.url));

describe("verifyClaims: a quote must really be on the page", () => {
  const pages = ["Net sales\n$26,767 in total   for Q4 2026 – each month’s plan", "Returning rate: at least 45% each month"];
  const claim = (quote: string, page = 1) => ({ sentence: "s", page, quote });

  it("drops a made-up quote, a quote on the wrong page, and a quote too short to mean anything", () => {
    const { verified, unverified } = verifyClaims([claim("Net sales $26,767 in total"), claim("Net sales were $99,999 in total"), claim("Returning rate: at least 45%", 1), claim("45%", 2), claim("at least 45% each month", 3)], pages);
    expect(verified.map((c) => c.quote)).toEqual(["Net sales $26,767 in total"]);
    expect(unverified).toHaveLength(4);
  });

  it("ignores line breaks, spacing, case and typographic marks, which a PDF changes", () => {
    const { verified } = verifyClaims([claim("net sales $26,767 in total for Q4 2026 - each month's plan")], pages);
    expect(verified).toHaveLength(1);
  });
});

describe("readPages: two passes", () => {
  it("puts a figure that the quote doesn't state in 'not applied', and a sentence the model skipped", async () => {
    const pages = ["The net sales target for October is $6,507 and for November it is $10,433. Orders are tracked weekly."];
    const claims = [
      { sentence: "October net sales target is $6,507.", page: 1, quote: "target for October is $6,507" },
      { sentence: "November net sales target is $10,433.", page: 1, quote: "for November it is $10,433" },
      { sentence: "Orders are tracked weekly.", page: 1, quote: "Orders are tracked weekly" },
    ];
    const model = scriptedReader({ claims }, { targets: [{ claim: 1, month: "2026-10", metric: "net_sales", value: 650701 }, { claim: 2, month: "2026-11", metric: "net_sales", value: 1043300 }], unapplied: [] });
    const out = await readPages(pages, { model });
    expect(out.targets.map((t) => [t.month, t.metric, t.value])).toEqual([["2026-11", "net_sales", 1043300]]);
    expect(out.unapplied.map((u) => u.sentence)).toEqual(["October net sales target is $6,507.", "Orders are tracked weekly."]);
    expect(out.unapplied[0]!.reason).toMatch(/not written in the quoted text/);
  });

  it("turns the fixture SOW into the expected targets and pages, and the second pass never sees the pages", async () => {
    const pages = await pdfPages(new Uint8Array(fixture("sow.pdf")));
    expect(pages).toHaveLength(2);
    const model = scriptedReader(SOLENNE_PASS1, SOLENNE_PASS2);
    const out = await readPages(pages, { model });

    expect(out.targets.map((t) => [t.month, t.metric, t.value, t.page])).toEqual([
      ["2026-10", "net_sales", 650700, 1],
      ["2026-10", "returning_customer_rate", 0.45, 1],
      ["2026-11", "net_sales", 1043300, 1],
      ["2026-11", "returning_customer_rate", 0.45, 1],
      ["2026-12", "net_sales", 982700, 1],
      ["2026-12", "returning_customer_rate", 0.45, 1],
    ]);
    expect(out.targets[0]!.sentence).toBe("The net sales target for October 2026 is $6,507.");
    // The quarter total, the refund rate (not a plan metric) and the Black Friday goal (a weekend) are shown, not dropped.
    expect(out.unapplied.map((u) => u.sentence).sort()).toEqual([
      "At least 30 new customers during Black Friday weekend, 2026-11-27 to 2026-11-30.",
      "Net sales target is $26,767 in total for Q4 2026.",
      "Refund rate is no more than 6% in each month from 2026-10-01 to 2026-12-31.",
    ]);
    expect(out.unapplied.find((u) => /Refund rate/.test(u.sentence))!.reason).toMatch(/refund_rate/);
    expect(out.unverified).toEqual([{ sentence: MADE_UP_CLAIM.sentence, page: MADE_UP_CLAIM.page }]);

    const [pass1, pass2] = model.doGenerateCalls.map((c) => JSON.stringify(c.prompt));
    expect(pass1).toContain("Statement of Work");
    expect(pass1).toContain("untrusted");
    expect(pass2).not.toContain("Statement of Work");
    expect(pass2).not.toContain("Gross margin"); // an unverified sentence goes no further
  });
});

describe("readPlanSheet", () => {
  it("reads a plan sheet with the fixture parser and needs no model", () => {
    const out = readPlanSheet(fixture("plan.csv").toString("utf8"));
    expect(out.targets).toHaveLength(16 * 5);
    expect(out.targets.find((t) => t.month === "2026-11" && t.metric === "net_sales")!.value).toBe(1043327);
    expect(out.unapplied).toEqual([]);
  });

  it("refuses a sheet that isn't in the plan format", () => {
    expect(() => readPlanSheet("a,b\n1,2")).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});
