import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkClaims, ledgerFromToolResults } from "../agent/checker";
import type { ExtraToolDeps } from "../agent/extra-types";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { calendarEvents, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import type { TenantContext } from "../tenancy/context";
import { loadDataset, readFixture, shopifyId } from "../../scripts/fixtures/load-db";
import { loadCalendar, loadCallNotes, readCallNoteFiles } from "../../scripts/fixtures/load-why";
import { loadPlan as loadPlanFixture, readFixtureFile } from "../../scripts/fixtures/load-pace";
import { STORES } from "../../scripts/seed/stores.js";
import { driverTree } from "./driver-tree";
import { buildExplainGapTool, explainGap, explainGapInput, type ExplainGapResult } from "./explain";
import { buildEvidencePack } from "./pack";
import { buildCalendarNotesTools, getCalendar, getCalendarInput, getNotes, getNotesInput, zeroSalesDays } from "./tools";

let db: Db;
let tenantId: string;
let ctx: TenantContext;
let viewer: TenantContext;
const steps: { tool: string; ok: boolean }[] = [];

beforeAll(async () => {
  setTestNow("2026-11-02T12:00:00-05:00"); // the data ends on 2026-10-31, so October is the last complete month
  db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_solenne", name: "Solenne" }).returning();
  tenantId = t!.id;
  await loadDataset(db, tenantId, "solenne", readFixture("solenne").dataset);
  await loadPlanFixture(db, tenantId, readFixtureFile("solenne", "plan.csv"), "plan");
  await loadCalendar(db, tenantId, readFixtureFile("solenne", "calendar.csv"));
  await loadCallNotes(db, tenantId, readCallNoteFiles("solenne"));
  ctx = { tenantId, orgId: "org_solenne", userId: "u1", role: "gc_partner", shop: { domain: "s.myshopify.com", timezone: STORES.solenne.timezone, currency: "USD", status: "connected" } };
  viewer = { ...ctx, role: "client_viewer" };
}, 240_000);

afterAll(() => setTestNow(null));

// ---- A scripted model. doGenerate sees the prompt, so each investigator can be told apart by the driver it was given.
const usage = (i: number, o: number) => ({ inputTokens: { total: i, noCache: i, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: o, text: o, reasoning: undefined } });
const callTools = (...calls: { name: string; input: unknown }[]) => ({
  content: calls.map((c, i) => ({ type: "tool-call" as const, toolCallId: `c${i}`, toolName: c.name, input: JSON.stringify(c.input) })),
  finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
  usage: usage(300, 40),
  warnings: [],
});
const say = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: "end_turn" }, usage: usage(200, 60), warnings: [] });

interface Seen {
  system: string;
  user: string;
  tools: string[];
  results: { tool: string; text: string; queryId: string }[];
}
function seen(options: { prompt: unknown[]; tools?: unknown[] }): Seen {
  const prompt = options.prompt as { role: string; content: unknown }[];
  const results = prompt
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content as { type: string; toolName: string; output: unknown }[])
    .filter((p) => p.type === "tool-result")
    .map((p) => {
      const text = JSON.stringify(p.output);
      return { tool: p.toolName, text, queryId: /q_[0-9a-f]{12}/.exec(text)?.[0] ?? "" };
    });
  return {
    system: prompt.filter((m) => m.role === "system").map((m) => String(m.content)).join("\n"),
    user: JSON.stringify(prompt.filter((m) => m.role === "user")),
    tools: (options.tools ?? []).map((t) => (t as { name: string }).name),
    results,
  };
}
const fakeModel = (respond: (s: Seen) => object) => new MockLanguageModelV4({ doGenerate: async (options) => respond(seen(options as never)) as never });
const isSynthesis = (s: Seen) => s.system.startsWith("You write the explanation");
const findQuery = (s: Seen, tool: string) => s.results.find((r) => r.tool === tool)?.queryId ?? "";

function deps(model: MockLanguageModelV4, as: TenantContext = ctx): ExtraToolDeps {
  return { ctx: as, db, model, now: new Date("2026-11-02T17:00:00Z"), calls: new Map(), write: () => undefined, onStep: (e) => steps.push({ tool: e.tool, ok: e.ok }) };
}

describe("driverTree", () => {
  it("S9: October's biggest drag is new-customer orders", async () => {
    const tree = await driverTree(db, tenantId, { month: "2026-10" });
    expect(tree).toMatchObject({ month: "2026-10", targetCents: 650688, actualCents: 590200, gapCents: -60488 });
    expect(tree.drivers[0]).toMatchObject({ kind: "new_customer_orders", planned: 44, actual: 34, unit: "count" });
    expect(tree.drivers[0]!.deltaCents).toBeLessThan(-60488 / 2);
    expect(tree.drivers.map((d) => d.kind).sort()).toEqual(["new_customer_aov", "new_customer_orders", "refunds", "returning_customer_aov", "returning_customer_orders"]);
  });

  it("adds up to the gap exactly, every month the plan covers, with the largest pull first", async () => {
    for (const month of ["2025-09", "2025-11", "2026-01", "2026-04", "2026-05", "2026-07", "2026-09", "2026-10"]) {
      const tree = await driverTree(db, tenantId, { month });
      expect(tree.drivers).toHaveLength(5);
      expect(tree.drivers.reduce((s, d) => s + d.deltaCents, 0), month).toBe(tree.gapCents);
      expect(tree.gapCents).toBe(tree.actualCents - tree.targetCents);
      const sizes = tree.drivers.map((d) => Math.abs(d.deltaCents));
      expect(sizes, month).toEqual([...sizes].sort((a, b) => b - a));
      for (const d of tree.drivers) expect(Number.isInteger(d.deltaCents)).toBe(true);
    }
  });

  it("is the same every time", async () => {
    expect(await driverTree(db, tenantId, { month: "2026-09" })).toEqual(await driverTree(db, tenantId, { month: "2026-09" }));
  });

  it("says so when the plan has no target for the month, and rejects a bad month", async () => {
    await expect(driverTree(db, tenantId, { month: "2031-01" })).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(driverTree(db, tenantId, { month: "October" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("get_calendar and get_notes", () => {
  it("returns the events that overlap the range, with the text under untrusted", async () => {
    const res = await getCalendar(deps(fakeModel(() => say("{}"))), { from: "2026-10-01", to: "2026-10-04" });
    expect(res.data).toEqual([]); // the Meta cut starts on the 5th
    const later = await getCalendar(deps(fakeModel(() => say("{}"))), { from: "2026-10-01", to: "2026-10-31" });
    expect(later.data).toHaveLength(1);
    expect(later.data[0]).toMatchObject({ dateFrom: "2026-10-05", dateTo: "2026-12-31" });
    expect(later.data[0]!.untrusted.title).toMatch(/Meta prospecting budget reduced/);
    expect(JSON.stringify(later.data[0]!).replace(JSON.stringify(later.data[0]!.untrusted), "")).not.toMatch(/Meta/);
    expect(ledgerFromToolResults([later]).entries).toHaveLength(0); // text from a calendar is never a source of numbers
  });

  it("finds notes by date range and by search term, and cites them by title and date", async () => {
    const d = deps(fakeModel(() => say("{}")));
    const byDate = await getNotes(d, { from: "2026-08-01", to: "2026-09-30" });
    expect(byDate.data.map((n) => n.heldOn)).toEqual(["2026-08-27"]);
    expect(byDate.data[0]!.untrusted.title).toBe("Solenne x Growth Capital: supply check-in");
    const bySearch = await getNotes(d, { search: "Black Friday" });
    expect(bySearch.data.map((n) => n.heldOn)).toEqual(["2026-10-01", "2025-12-09", "2025-09-04"]);
    expect((await getNotes(d, { search: "budget cut" })).data.map((n) => n.heldOn)).toContain("2026-10-01");
  });

  it("reads only this tenant's rows", async () => {
    const [other] = await db.insert(tenants).values({ orgId: "org_other", name: "Other" }).returning();
    await db.insert(calendarEvents).values({ tenantId: other!.id, dateFrom: "2026-10-10", dateTo: "2026-10-12", title: "Other brand sale", type: "promo", channel: "all", details: "" });
    const res = await getCalendar(deps(fakeModel(() => say("{}"))), { from: "2026-10-01", to: "2026-10-31" });
    expect(JSON.stringify(res.data)).not.toMatch(/Other brand sale/);
  });

  it("takes no tenant or other key, and needs a range or a search", () => {
    expect(getCalendarInput.safeParse({ from: "2026-10-01", to: "2026-10-31", tenantId: "x" }).success).toBe(false);
    expect(getNotesInput.safeParse({ search: "serum", orgId: "x" }).success).toBe(false);
    expect(getNotesInput.safeParse({}).success).toBe(false);
    expect(getNotesInput.safeParse({ from: "2026-10-01" }).success).toBe(false);
    expect(explainGapInput.safeParse({ month: "2026-10", tenantId: "x" }).success).toBe(false);
  });

  it("offers a client viewer neither tool, and a Growth Capital role both", () => {
    const m = fakeModel(() => say("{}"));
    expect(Object.keys(buildCalendarNotesTools(deps(m, viewer)))).toEqual([]);
    expect(Object.keys(buildCalendarNotesTools(deps(m, ctx))).sort()).toEqual(["get_calendar", "get_notes"]);
    expect(Object.keys(buildCalendarNotesTools(deps(m, { ...ctx, role: "gc_admin" }))).sort()).toEqual(["get_calendar", "get_notes"]);
  });
});

describe("zero_sales_days", () => {
  it("S7: September shows the Hero Vitamin C Serum with no sales for 11 days in a row, the 3rd to the 13th", async () => {
    const serum = shopifyId.product("P_001");
    const res = await zeroSalesDays(deps(fakeModel(() => say("{}"))), { productIds: [serum], from: "2026-09-01", to: "2026-09-30" });
    // 14 quiet days in all: the planted stock-out (11 days in a row) and 3 other quiet days
    expect(res.data[0]).toMatchObject({ productId: serum, daysChecked: 30, zeroSalesDays: 14, longestRun: { from: "2026-09-03", to: "2026-09-13", days: 11 } });
    expect(res.data[0]!.untrusted.product).toMatch(/Vitamin C Serum/);
  });

  it("S5: the Lip Tint in Fig sold nothing from 07-19 to the end of July (a variant, not only a product)", async () => {
    const fig = shopifyId.variant("V_029");
    const res = await zeroSalesDays(deps(fakeModel(() => say("{}"))), { variantIds: [fig], from: "2026-07-01", to: "2026-07-31" });
    expect(res.data[0]).toMatchObject({ variantId: fig, longestRun: { from: "2026-07-19", to: "2026-07-31", days: 13 }, untrusted: { product: "Lip Tint", variant: "Fig" } });
    await expect(zeroSalesDays(deps(fakeModel(() => say("{}"))), { from: "2026-07-01", to: "2026-07-31" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("the evidence pack", () => {
  const packOf = (month: string, as: TenantContext = ctx) => buildEvidencePack(deps(fakeModel(() => say("{}")), as), month);

  it("holds the movers, refunds, days with no sales, the calendar and the notes, each under its own q_ id", async () => {
    const pack = await packOf("2026-10");
    expect(pack.items.map((i) => i.tool)).toEqual(["product_movers", "variant_movers", "query_metric", "refunds_by_product", "zero_sales_days", "get_calendar", "get_notes"]);
    expect(new Set(pack.items.map((i) => i.result.queryId)).size).toBe(7);
    for (const i of pack.items) expect(pack.text).toContain(`[${i.result.queryId}]`);
    expect(pack.text).toMatch(/PRODUCT MOVERS, 2026-10 against 2026-09/);
    expect(pack.text).toMatch(/Barrier Cream: units 25 \(was 31, down 6\)/);
    expect(pack.text).toMatch(/REFUNDS, all products, 2026-10 against 2026-09: refunds \$346.00 \(was \$421.90\); refund rate 4.0% \(was 4.9%\)/);
  });

  it("puts the calendar entry and the call note in the untrusted block with their figures hidden", async () => {
    const { text } = await packOf("2026-10");
    const untrusted = text.slice(text.indexOf("== UNTRUSTED TEXT"));
    expect(untrusted).toMatch(/2026-10-05 to 2026-12-31, budget_change, meta: "Meta prospecting budget reduced by \[figure\]"/);
    expect(untrusted).toMatch(/2026-10-01, "Solenne x Growth Capital: Q4 budget and planning"/);
    expect(text).not.toMatch(/40%/);
    expect(text.slice(0, text.indexOf("== UNTRUSTED TEXT"))).not.toMatch(/Meta prospecting/);
  });

  it("shows September's serum stock-out (11 days) and the supply note, June's Barrier Cream refunds, and July's Fig", async () => {
    const sep = (await packOf("2026-09")).text;
    expect(sep).toMatch(/Hero Vitamin C Serum: 14 days with no sales out of 30; the longest run was 11 days, 2026-09-03 to 2026-09-13/);
    expect(sep).toMatch(/2026-08-27, "Solenne x Growth Capital: supply check-in"/);
    expect((await packOf("2026-06")).text).toMatch(/REFUNDS BY PRODUCT[^\n]*\n\s+- Barrier Cream: refunds \$251.00 \(was \$0.00\); refund rate 15.2% \(was 1.3%\)/);
    expect((await packOf("2026-07")).text).toMatch(/Lip Tint \/ Fig: 25 days with no sales out of 31; the longest run was 13 days, 2026-07-19 to 2026-07-31/);
  });

  it("gives a client viewer store data only: no calendar and no notes", async () => {
    const pack = await packOf("2026-10", viewer);
    expect(pack.items.map((i) => i.tool)).not.toContain("get_calendar");
    expect(pack.items.map((i) => i.tool)).not.toContain("get_notes");
    expect(pack.text).not.toMatch(/Meta prospecting|Q4 budget|CALENDAR|CALL NOTES|UNTRUSTED/);
    expect(pack.text).toMatch(/PRODUCT MOVERS/);
  });

  it("is a set of results the number check can read: every figure in the text is in a result", async () => {
    const pack = await packOf("2026-09");
    const ledger = ledgerFromToolResults(pack.items.map((i) => i.result));
    const store = pack.text.slice(0, pack.text.indexOf("== UNTRUSTED TEXT")).replace(/^\[q_[0-9a-f]{12}\]/gm, "");
    expect(checkClaims(store, ledger, []).unmatched).toEqual([]);
  });
});

describe("the evidence from the data (no model)", () => {
  const highlightsOf = async (month: string, as: TenantContext = ctx) => (await buildEvidencePack(deps(fakeModel(() => say("{}")), as), month)).highlights.map((h) => h.text);

  it("S9: October has the Meta budget cut on the calendar and the Q4 budget note, cited by title and date", async () => {
    expect(await highlightsOf("2026-10")).toEqual([
      "The data shows Barrier Cream / 100 ml had no sales for 12 days in a row (2026-10-05 to 2026-10-16).",
      "On the calendar: Meta prospecting budget reduced (2026-10-05 to 2026-12-31).",
      'Call note: "Solenne x Growth Capital: Q4 budget and planning", 2026-10-01.',
    ]);
  });

  it("S7: September has the serum's 11 days in a row, two more stock-outs, and the supply note, which mentions the serum", async () => {
    const lines = await highlightsOf("2026-09");
    expect(lines).toContain("The data shows Hero Vitamin C Serum had no sales for 11 days in a row (2026-09-03 to 2026-09-13).");
    expect(lines).toContain("The data shows Daily Gel Cleanser had no sales for 12 days in a row (2026-09-02 to 2026-09-13).");
    expect(lines).toContain('Call note: "Solenne x Growth Capital: supply check-in", 2026-08-27 (it mentions Hero Vitamin C Serum).');
    expect(lines.filter((l) => l.startsWith("Call note:"))).toHaveLength(1); // the Q4 note and the others are outside the window or unrelated
    expect(lines.some((l) => l.startsWith("On the calendar:"))).toBe(false);
  });

  it("S5: July has the Lip Tint in Fig, which took off and then sold nothing to the end of the month, and the Summer SPF campaign", async () => {
    const lines = await highlightsOf("2026-07");
    expect(lines).toContain("The data shows Lip Tint / Fig sold 7 units in 2026-07, against 3 the month before, then had no sales for 13 days in a row (2026-07-19 to 2026-07-31).");
    expect(lines).toContain("On the calendar: Summer SPF campaign (2026-07-01 to 2026-07-31).");
    expect(lines.some((l) => l.startsWith("Call note:"))).toBe(false);
  });

  it("April, where nothing was planted: no stock-out, no calendar entry and no note", async () => {
    expect(await highlightsOf("2026-04")).toEqual([]);
  });

  it("a note comes in only when it is about a flagged product, shares a word with an overlapping event while recent, or is dated in the month", async () => {
    // October: the supply note (2026-08-27) is in the 90-day window but is about the serum, which is not flagged in October
    expect((await highlightsOf("2026-10")).join(" ")).not.toContain("supply check-in");
    // December 2025: the debrief is dated in the month
    expect((await highlightsOf("2025-12")).join(" ")).toContain('Call note: "Solenne x Growth Capital: Black Friday debrief", 2025-12-09.');
  });

  it("gives a client viewer stock-outs only: nothing about the calendar or the notes", async () => {
    const lines = await highlightsOf("2026-10", viewer);
    expect(lines).toEqual(["The data shows Barrier Cream / 100 ml had no sales for 12 days in a row (2026-10-05 to 2026-10-16)."]);
    expect((await highlightsOf("2026-09", viewer)).every((l) => l.startsWith("The data shows"))).toBe(true);
  });

  it("is in the explanation even when every investigator finds nothing, and then does not say 'no clear cause'", async () => {
    const model = fakeModel((s) => (isSynthesis(s) ? say("x") : say('{"found": false}')));
    const res = await explainGap(deps(model), { month: "2026-09" });
    const text = res.data.untrusted.synthesis!;
    expect(res.data.findings).toEqual([]);
    expect(res.data.noCauseFound).toBe(false);
    expect(text).not.toMatch(/No clear cause/);
    expect(text).toContain("Evidence from the data: The data shows Daily Gel Cleanser had no sales for 12 days in a row (2026-09-02 to 2026-09-13). The data shows Hero Vitamin C Serum had no sales for 11 days in a row (2026-09-03 to 2026-09-13).");
    expect(text).toContain('Call note: "Solenne x Growth Capital: supply check-in", 2026-08-27 (it mentions Hero Vitamin C Serum).');
    expect(text).toContain("they are not proof of what caused the gap");
    expect(text).toMatch(/^September 2026: net sales were \$6,294.48 against a plan of \$7,045.68, \$751.20 below plan \(10.7% of the target\)\./);
  });
});

// The pack's ids, as the investigator's prompt shows them.
const packId = (s: Seen, label: string) => new RegExp(`\\[(q_[0-9a-f]{12})\\] ${label}`).exec(s.user)?.[1] ?? "";

describe("explain_gap", () => {
  // The scripted investigators for October: the one on new-customer orders reads the pack and answers in one step, and the
  // others find nothing.
  const october = (finding: (s: Seen) => string, synthesis = "Net sales finished $604.88 below plan.") =>
    fakeModel((s) => {
      if (isSynthesis(s)) return say(synthesis);
      if (!s.user.includes("Driver to explain: New-customer orders.")) return say('{"found": false}');
      return say(finding(s));
    });
  const goodFinding = (s: Seen) =>
    JSON.stringify({
      found: true,
      finding: "The Barrier Cream sold 25 units, down from 31. The calendar shows the Meta prospecting budget was reduced from 2026-10-05, and the budget call note of 2026-10-01 records the same decision.",
      queryIds: [packId(s, "CALENDAR"), packId(s, "CALL NOTES"), packId(s, "PRODUCT MOVERS")],
    });

  it("S9: investigates the top three drivers from the pack, keeps the Meta budget cut with its calendar row and call note, and synthesises", async () => {
    const model = october(goodFinding, "October net sales finished $604.88 below plan, mostly because new-customer orders came in at 34 against a plan of 44 after the Meta prospecting budget was reduced.");
    const d = deps(model);
    const res = await explainGap(d, { month: "2026-10" });

    expect(res.data).toMatchObject({ month: "2026-10", gapCents: -60488, noCauseFound: false, smallGap: false });
    expect(res.data.drivers.map((x) => x.investigated)).toEqual([true, true, true, false, false]);
    expect(res.data.drivers[0]).toMatchObject({ kind: "new_customer_orders", planned: 44, actual: 34 });
    expect(res.data.findings).toHaveLength(1);
    const f = res.data.findings[0]!;
    expect(f.driverId).toBe("2026-10:new_customer_orders");
    expect(f.figures.counts.sort()).toEqual([25, 31]);
    expect(f.evidence.map((e) => e.tool).sort()).toEqual(["get_calendar", "get_notes", "product_movers"]);
    expect(f.evidence.find((e) => e.tool === "get_notes")!.notes).toEqual([
      { heldOn: "2026-10-01", untrusted: { title: "Solenne x Growth Capital: Q4 budget and planning" } },
      { heldOn: "2026-08-27", untrusted: { title: "Solenne x Growth Capital: supply check-in" } },
    ]);
    expect(f.evidence.find((e) => e.tool === "get_calendar")!.events![0]).toMatchObject({ dateFrom: "2026-10-05", untrusted: { title: "Meta prospecting budget reduced by [figure]" } });
    expect(f.evidence.find((e) => e.tool === "product_movers")!.products).toEqual([{ untrusted: { product: "Barrier Cream" } }]);
    expect(res.data.untrusted.synthesis).toMatch(/Meta prospecting budget/);

    // three investigators, one step each, and one synthesis call; the spend is returned for the lead to account for
    expect(model.doGenerateCalls).toHaveLength(4);
    expect(res.meta.investigators.map((i) => [i.outcome, i.steps, i.toolCalls])).toEqual([["finding", 1, 0], ["no_cause", 1, 0], ["no_cause", 1, 0]]);
    expect(res.meta.pack).toEqual({ pieces: 7, failed: false });
    expect(res.meta.usage.investigators.inputTokens).toBe(3 * 200);
    expect(res.meta.usage.synthesis).toEqual({ inputTokens: 200, outputTokens: 60 });
    expect(res.meta.usage.total.inputTokens).toBe(800);
    expect(res.meta.synthesis.source).toBe("model");
    expect(res.meta.dropped).toEqual({ unmatchedNumbers: 0, noEvidence: 0, unreadable: 0, failed: 0, synthesis: false });
    expect(steps.some((x) => x.tool === "get_notes" && x.ok)).toBe(false); // the pack is code, not model steps
  });

  it("puts the pack into the turn's results, so the number check accepts a pack figure and a finding that cites a pack id", async () => {
    const d = deps(october(goodFinding));
    const res = await explainGap(d, { month: "2026-10" });
    expect([...d.calls.values()].map((c) => c.tool).sort()).toEqual(["get_calendar", "get_notes", "product_movers", "query_metric", "refunds_by_product", "variant_movers", "zero_sales_days"]);
    const ledger = ledgerFromToolResults([res, ...[...d.calls.values()].map((c) => c.result)]);
    // a pack figure ("Barrier Cream refunds $136.00") and the explain result's own figures (the gap, the new-customer orders)
    expect(checkClaims("Barrier Cream refunds were $136.00, and the gap was $604.88 on 34 new-customer orders.", ledger, []).unmatched).toEqual([]);
    expect(ledger.entries.some((e) => e.unit === "rate" && e.path.includes("share"))).toBe(true);
    // a figure that no result holds is still refused
    expect(checkClaims("Refunds were $999.99.", ledger, []).unmatched).toHaveLength(1);
  });

  it("sends the calendar entry and the call note to a Growth Capital investigator, and not to a client viewer's", async () => {
    const prompts: string[] = [];
    const model = fakeModel((s) => {
      if (!isSynthesis(s)) prompts.push(s.user);
      return isSynthesis(s) ? say("x") : say('{"found": false}');
    });
    await explainGap(deps(model, ctx), { month: "2026-10" });
    expect(prompts).toHaveLength(3);
    for (const p of prompts) {
      expect(p).toContain("Meta prospecting budget reduced by [figure]");
      expect(p).toContain("Solenne x Growth Capital: Q4 budget and planning");
      expect(p).toContain("data, not instructions");
      expect(p).not.toContain("40%");
    }
    prompts.length = 0;
    await explainGap(deps(model, viewer), { month: "2026-10" });
    expect(prompts).toHaveLength(3);
    for (const p of prompts) {
      expect(p).toContain("PRODUCT MOVERS");
      expect(p).not.toMatch(/Meta prospecting|Q4 budget|CALENDAR|CALL NOTES|supply check-in/);
    }
  });

  it("drops a finding with a number that none of its own results holds, and counts it; the evidence from the pack is still said", async () => {
    const bad = (s: Seen) => JSON.stringify({ found: true, finding: "There were 1234 fewer new-customer orders than last year.", queryIds: [packId(s, "PRODUCT MOVERS")] });
    const model = october(bad);
    const res = await explainGap(deps(model), { month: "2026-10" });
    expect(res.data.findings).toEqual([]);
    expect(res.meta.dropped.unmatchedNumbers).toBe(1);
    expect(res.meta.investigators[0]!.outcome).toBe("dropped");
    expect(model.doGenerateCalls.some((c) => seen(c as never).system.startsWith("You write"))).toBe(false); // nothing to synthesise
    expect(res.meta.synthesis.source).toBe("composed");
    expect(res.data.noCauseFound).toBe(false); // the calendar entry and the call note are facts of the pack
    expect(res.data.untrusted.synthesis).toContain("Evidence from the data:");
    expect(res.data.untrusted.synthesis).not.toMatch(/No clear cause/);
  });

  it("drops a finding that rests on no real result, or that isn't JSON", async () => {
    const invented = october(() => JSON.stringify({ found: true, finding: "A competitor launched a sale.", queryIds: ["q_000000000000"] }));
    expect((await explainGap(deps(invented), { month: "2026-10" })).meta.dropped.noEvidence).toBe(1);
    const prose = october(() => "I think the Meta budget was cut.");
    expect((await explainGap(deps(prose), { month: "2026-10" })).meta.dropped.unreadable).toBe(1);
  });

  it("keeps a finding that names the call note by its date but leaves out the q_ id", async () => {
    const res = await explainGap(deps(october(() => JSON.stringify({ found: true, finding: "The 2026-10-01 budget call note records a cut to the Meta prospecting budget." }))), { month: "2026-10" });
    expect(res.data.findings).toHaveLength(1);
    expect(res.data.findings[0]!.evidence.map((e) => e.tool)).toEqual(["get_notes"]);
  });

  it("writes the explanation itself when the model's synthesis states a number nothing holds", async () => {
    const d = deps(october(goodFinding, "Net sales missed plan by $9,999.00 because of the Meta cut."));
    const res = await explainGap(d, { month: "2026-10" });
    expect(res.meta.dropped.synthesis).toBe(true);
    expect(res.meta.synthesis.source).toBe("composed");
    const text = res.data.untrusted.synthesis!;
    expect(text).not.toMatch(/9,999/);
    expect(text).toContain('call note "Solenne x Growth Capital: Q4 budget and planning", 2026-10-01');
    expect(text).toContain("$604.88 below plan (9.3% of the target)");
    expect(text).toContain("Evidence from the data: The data shows Barrier Cream / 100 ml had no sales for 12 days in a row (2026-10-05 to 2026-10-16).");
    expect(text).not.toContain("On the calendar:"); // the finding already cites that calendar entry
    // and it passes the number check, against this tool's result and the pack in the turn's results
    expect(checkClaims(text, ledgerFromToolResults([res, ...[...d.calls.values()].map((c) => c.result)]), []).unmatched).toEqual([]);
    expect(res.data.findings).toHaveLength(1);
  });

  it("S7: the September investigator cites the serum's 11 days with no sales and the supplier call note from the pack", async () => {
    const model = fakeModel((s) => {
      if (isSynthesis(s)) return say("September fell short because the serum was out of stock.");
      if (!s.user.includes("Driver to explain: Returning-customer orders.")) return say('{"found": false}');
      return say(
        JSON.stringify({
          found: true,
          finding: "The Hero Vitamin C Serum had no sales for 11 days in a row, from 2026-09-03 to 2026-09-13, while the supplier's batch was delayed (the supply check-in call note of 2026-08-27).",
          queryIds: [packId(s, "DAYS WITH NO SALES"), packId(s, "CALL NOTES")],
        }),
      );
    });
    const res = await explainGap(deps(model), { month: "2026-09" });
    const f = res.data.findings.find((x) => x.driverId === "2026-09:returning_customer_orders")!;
    expect(f.figures.counts).toEqual([11]);
    expect(f.untrusted.summary).toMatch(/Vitamin C Serum/);
    expect(f.evidence.find((e) => e.tool === "get_notes")!.notes).toEqual([{ heldOn: "2026-08-27", untrusted: { title: "Solenne x Growth Capital: supply check-in" } }]);
    expect(f.evidence.find((e) => e.tool === "zero_sales_days")!.products).toEqual([{ untrusted: { product: "Hero Vitamin C Serum" } }]);
    // the finding already says the serum's stock-out and cites the supply note, so the evidence block leaves both out and keeps the rest
    const text = res.data.untrusted.synthesis!;
    expect(text).toContain("The data shows Daily Gel Cleanser had no sales for 12 days in a row (2026-09-02 to 2026-09-13).");
    expect(text).not.toContain("The data shows Hero Vitamin C Serum had no sales");
    expect(text).not.toContain("Call note:");
  });

  it("lets an investigator make a follow-up call with a tool, and counts it", async () => {
    const model = fakeModel((s) => {
      if (isSynthesis(s)) return say("x");
      if (!s.user.includes("Driver to explain: New-customer orders.")) return say('{"found": false}');
      if (s.results.length === 0) return callTools({ name: "get_notes", input: { search: "budget" } });
      return say(JSON.stringify({ found: true, finding: "The call note of 2026-10-01 records the cut.", queryIds: [findQuery(s, "get_notes")] }));
    });
    const res = await explainGap(deps(model), { month: "2026-10" });
    expect(res.meta.investigators[0]).toMatchObject({ outcome: "finding", steps: 2, toolCalls: 1 });
    expect(steps.some((x) => x.tool === "explain_gap:get_notes" && x.ok)).toBe(true);
  });

  it("gives a client viewer's investigators store-data tools only", async () => {
    const offered = new Set<string>();
    const model = fakeModel((s) => {
      s.tools.forEach((t) => offered.add(t));
      return isSynthesis(s) ? say("x") : say('{"found": false}');
    });
    const res = await explainGap(deps(model, viewer), { month: "2026-10" });
    expect([...offered].sort()).toEqual(["get_inventory", "get_orders", "query_metric", "zero_sales_days"]);
    expect(res.data.untrusted.synthesis).toContain("Evidence from the data: The data shows Barrier Cream / 100 ml had no sales");
    expect(res.data.untrusted.synthesis).not.toMatch(/calendar|call note|Meta|Q4 budget/i);
    // and a Growth Capital role's investigators get the two extra tools
    offered.clear();
    await explainGap(deps(model, ctx), { month: "2026-10" });
    expect([...offered].sort()).toEqual(["get_calendar", "get_inventory", "get_notes", "get_orders", "query_metric", "zero_sales_days"]);
  });

  it("counts an investigator that fails, with the tokens of the steps it finished, and still answers from the others", async () => {
    const model = fakeModel((s) => {
      if (isSynthesis(s)) return say("x");
      if (!s.user.includes("Driver to explain: New-customer orders.")) return say('{"found": false}');
      if (s.results.length === 0) return callTools({ name: "get_calendar", input: { from: "2026-10-01", to: "2026-10-31" } });
      throw new Error("boom");
    });
    const res = await explainGap(deps(model), { month: "2026-10" }, { investigatorTimeoutMs: 5_000 });
    expect(res.meta.dropped.failed).toBe(1);
    expect(res.meta.investigators.map((i) => i.outcome)).toEqual(["failed", "no_cause", "no_cause"]);
    expect(res.meta.usage.investigators.inputTokens).toBe(300 + 200 + 200); // the failed one's first step still counts
  });

  it("April, where nothing was planted: no investigator finds a cause, the explanation says so and calls the miss small, and no model writes it", async () => {
    const model = fakeModel((s) => (isSynthesis(s) ? say("The serum went out of stock.") : say('{"found": false}')));
    const res = await explainGap(deps(model), { month: "2026-04" });
    expect(res.data).toMatchObject({ gapCents: -1400, smallGap: true, noCauseFound: true });
    const text = res.data.untrusted.synthesis!;
    expect(text).toMatch(/^April 2026: net sales were \$5,838.15 against a plan of \$5,852.15, \$14.00 below plan \(0.2% of the target\), so the miss is small\./);
    expect(text).toMatch(/No clear cause was found for this small miss/);
    expect(text).not.toMatch(/stock|supplier|viral|budget/i);
    expect(checkClaims(text, ledgerFromToolResults([res]), []).unmatched).toEqual([]);
    expect(model.doGenerateCalls).toHaveLength(3); // no synthesis call
  });

  it("refuses a month that isn't finished, and says when the plan has no target", async () => {
    const m = fakeModel(() => say("{}"));
    await expect(explainGap(deps(m), { month: "2026-11" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(explainGap(deps(m), { month: "2024-01" })).rejects.toMatchObject({ code: "NO_DATA" });
  });

  it("defaults to the last complete month, and the tool returns a recoverable error as data", async () => {
    const model = fakeModel((s) => (isSynthesis(s) ? say("x") : say('{"found": false}')));
    const d = deps(model);
    const t = buildExplainGapTool(d);
    const ok = (await t.execute!({}, { toolCallId: "t1", messages: [] } as never)) as unknown as ExplainGapResult;
    expect(ok.data.month).toBe("2026-10");
    expect(d.calls.has(ok.queryId)).toBe(true);
    const err = (await t.execute!({ month: "2026-11" }, { toolCallId: "t2", messages: [] } as never)) as unknown as { error: { code: string } };
    expect(err.error.code).toBe("INVALID_INPUT");
  });
});
