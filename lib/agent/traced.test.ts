import { describe, expect, it } from "vitest";
import { MAX_TRACED_FIGURES, tracedFigures, type SourceInfo } from "./traced";

const Q1 = "q_aaaaaaaaaaaa";
const Q2 = "q_bbbbbbbbbbbb";
const info: Record<string, SourceInfo> = {
  [Q1]: { tool: "query_metric", range: { from: "2026-09-01", to: "2026-09-30" }, asOf: "2026-10-31T10:34:00.000Z" },
  [Q2]: { tool: "get_cohorts" },
};
const at = (answer: string, text: string, from = 0) => {
  const start = answer.indexOf(text, from);
  return { span: [start, start + text.length] as [number, number], queryId: Q1 };
};

describe("tracedFigures", () => {
  const answer = "Net sales were $12,340 and the refund rate was 18.4%.";

  it("takes the text from the answer and the source from the tool's friendly name, dates and sync time", () => {
    expect(tracedFigures(answer, [at(answer, "$12,340"), at(answer, "18.4%")], (id) => info[id])).toEqual([
      { text: "$12,340", queryId: Q1, source: "Sales metrics", range: { from: "2026-09-01", to: "2026-09-30" }, asOf: "2026-10-31T10:34:00.000Z", count: 1 },
      { text: "18.4%", queryId: Q1, source: "Sales metrics", range: { from: "2026-09-01", to: "2026-09-30" }, asOf: "2026-10-31T10:34:00.000Z", count: 1 },
    ]);
  });

  it("lists the figures in the order they appear, whatever order the checker gave them", () => {
    const out = tracedFigures(answer, [at(answer, "18.4%"), at(answer, "$12,340")], (id) => info[id]);
    expect(out.map((f) => f.text)).toEqual(["$12,340", "18.4%"]);
  });

  it("keeps one entry for the same text and query, and counts it", () => {
    const twice = "Sales were $5,000. Again: $5,000.";
    const out = tracedFigures(twice, [at(twice, "$5,000"), at(twice, "$5,000", 20)], (id) => info[id]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "$5,000", count: 2 });
  });

  it("keeps two entries for the same text from two queries, and leaves out dates it was not given", () => {
    const text = "There were 12 orders and 12 customers.";
    const out = tracedFigures(text, [at(text, "12"), { ...at(text, "12", 20), queryId: Q2 }], (id) => info[id]);
    expect(out.map((f) => [f.text, f.queryId, f.source])).toEqual([["12", Q1, "Sales metrics"], ["12", Q2, "Customer cohorts"]]);
    expect(out[1]).not.toHaveProperty("range");
    expect(out[1]).not.toHaveProperty("asOf");
  });

  it("names the store data when the query is unknown, and an unlisted tool by its own name", () => {
    expect(tracedFigures(answer, [at(answer, "$12,340")], () => undefined)[0]!.source).toBe("the store data");
    expect(tracedFigures(answer, [at(answer, "$12,340")], () => ({ tool: "get_something_new" }))[0]!.source).toBe("get_something_new");
  });

  it("stops at the cap but keeps counting the figures it already has", () => {
    const many = Array.from({ length: MAX_TRACED_FIGURES + 15 }, (_, i) => `$${1000 + i}`).join(" ") + " $1000";
    const spans = [...many.matchAll(/\$\d+/g)].map((m) => ({ span: [m.index!, m.index! + m[0].length] as [number, number], queryId: Q1 }));
    const out = tracedFigures(many, spans, (id) => info[id]);
    expect(out).toHaveLength(MAX_TRACED_FIGURES);
    expect(out[0]).toMatchObject({ text: "$1000", count: 2 });
  });

  it("skips a span with nothing in it", () => {
    expect(tracedFigures("  ", [{ span: [0, 2], queryId: Q1 }], (id) => info[id])).toEqual([]);
  });
});
