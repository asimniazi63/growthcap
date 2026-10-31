import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerFromToolResults } from "../agent/checker";
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
});

describe("explain_gap", () => {
  // The scripted investigators for October: the one on new-customer orders reads the data, the calendar and the notes, and the
  // others find nothing.
  const october = (finding: (s: Seen) => string, synthesis = "Net sales finished $604.88 below plan.") =>
    fakeModel((s): object => {
      if (isSynthesis(s)) return say(synthesis);
      if (!s.user.includes("Driver to investigate: New-customer orders.")) return say('{"found": false}');
      if (s.results.length === 0) {
        return callTools(
          { name: "query_metric", input: { metrics: ["new_customer_orders"], from: "2026-10-01", to: "2026-10-31" } },
          { name: "get_calendar", input: { from: "2026-10-01", to: "2026-10-31" } },
          { name: "get_notes", input: { from: "2026-09-25", to: "2026-10-31" } },
        );
      }
      return say(finding(s));
    });
  const goodFinding = (s: Seen) =>
    JSON.stringify({
      found: true,
      finding: "Only 34 new-customer orders came in. The calendar shows the Meta prospecting budget was reduced from 2026-10-05, and the 2026-10-01 budget call note records the same decision.",
      queryIds: [findQuery(s, "get_calendar"), findQuery(s, "get_notes"), findQuery(s, "query_metric")],
    });

  it("S9: investigates the top three drivers, keeps the Meta budget cut with its calendar row and call note, and synthesises", async () => {
    const model = october(goodFinding, "October net sales finished $604.88 below plan, mostly because new-customer orders came in at 34 against a plan of 44 after the Meta prospecting budget was reduced.");
    const d = deps(model);
    const res = await explainGap(d, { month: "2026-10" });

    expect(res.data).toMatchObject({ month: "2026-10", gapCents: -60488, noCauseFound: false });
    expect(res.data.drivers.map((x) => x.investigated)).toEqual([true, true, true, false, false]);
    expect(res.data.drivers[0]).toMatchObject({ kind: "new_customer_orders", planned: 44, actual: 34 });
    expect(res.data.findings).toHaveLength(1);
    const f = res.data.findings[0]!;
    expect(f.driverId).toBe("2026-10:new_customer_orders");
    expect(f.figures.counts).toEqual([34]);
    expect(f.evidence.map((e) => e.tool).sort()).toEqual(["get_calendar", "get_notes", "query_metric"]);
    expect(f.evidence.find((e) => e.tool === "get_notes")!.notes).toEqual([{ heldOn: "2026-10-01", untrusted: { title: "Solenne x Growth Capital: Q4 budget and planning" } }]);
    expect(f.evidence.find((e) => e.tool === "get_calendar")!.events![0]).toMatchObject({ dateFrom: "2026-10-05", untrusted: { title: expect.stringMatching(/Meta prospecting budget reduced/) } });
    expect(res.data.untrusted.synthesis).toMatch(/Meta prospecting budget/);

    // three investigators and one synthesis call; the spend is returned for the lead to account for
    expect(model.doGenerateCalls.filter((c) => !seen(c as never).system.startsWith("You write")).length).toBeGreaterThanOrEqual(4); // 3 first steps + 1 second step
    expect(res.meta.investigators.map((i) => i.outcome)).toEqual(["finding", "no_cause", "no_cause"]);
    expect(res.meta.usage.investigators.inputTokens).toBeGreaterThan(0);
    expect(res.meta.usage.synthesis).toEqual({ inputTokens: 200, outputTokens: 60 });
    expect(res.meta.usage.total.inputTokens).toBe(res.meta.usage.investigators.inputTokens + 200);
    expect(res.meta.dropped).toEqual({ unmatchedNumbers: 0, noEvidence: 0, unreadable: 0, failed: 0, synthesis: false });
    expect(steps.some((s) => s.tool === "explain_gap:get_notes" && s.ok)).toBe(true);
  });

  it("gives the lead a result whose every figure can be checked: drivers and the cited counts are in the ledger", async () => {
    const res = await explainGap(deps(october(goodFinding)), { month: "2026-10" });
    const values = ledgerFromToolResults([res]).entries;
    expect(values.some((e) => e.unit === "money" && Math.abs(e.value) === 604.88)).toBe(true); // the gap, from gapCents
    expect(values.some((e) => e.unit === "count" && e.value === 34)).toBe(true);
    expect(values.some((e) => e.unit === "rate" && e.path.includes("share"))).toBe(true);
  });

  it("drops a finding with a number that none of its own tool results holds, and counts it", async () => {
    const bad = (s: Seen) => JSON.stringify({ found: true, finding: "There were 1234 fewer new-customer orders than last year.", queryIds: [findQuery(s, "query_metric")] });
    const model = october(bad);
    const res = await explainGap(deps(model), { month: "2026-10" });
    expect(res.data.findings).toEqual([]);
    expect(res.data.noCauseFound).toBe(true);
    expect(res.meta.dropped.unmatchedNumbers).toBe(1);
    expect(res.meta.investigators[0]!.outcome).toBe("dropped");
    expect(model.doGenerateCalls.some((c) => seen(c as never).system.startsWith("You write"))).toBe(false); // nothing to synthesise
    expect(res.data.untrusted.synthesis).toBeNull();
  });

  it("drops a finding that rests on no real tool result, or that isn't JSON", async () => {
    const invented = october(() => JSON.stringify({ found: true, finding: "A competitor launched a sale.", queryIds: ["q_000000000000"] }));
    expect((await explainGap(deps(invented), { month: "2026-10" })).meta.dropped.noEvidence).toBe(1);
    const prose = october(() => "I think the Meta budget was cut.");
    expect((await explainGap(deps(prose), { month: "2026-10" })).meta.dropped.unreadable).toBe(1);
  });

  it("drops a synthesis that states a number the drivers and findings don't hold", async () => {
    const res = await explainGap(deps(october(goodFinding, "Net sales missed plan by $9,999.00 because of the Meta cut.")), { month: "2026-10" });
    expect(res.data.untrusted.synthesis).toBeNull();
    expect(res.meta.dropped.synthesis).toBe(true);
    expect(res.data.findings).toHaveLength(1); // the findings stand; the lead explains from them
  });

  it("S7: the September investigator finds the serum's days with no sales and the supplier call note", async () => {
    const serum = shopifyId.product("P_001");
    const model = fakeModel((s): object => {
      if (isSynthesis(s)) return say("September fell short because the serum was out of stock.");
      if (!s.user.includes("Driver to investigate: Returning-customer orders.")) return say('{"found": false}');
      if (s.results.length === 0) {
        return callTools(
          { name: "zero_sales_days", input: { productIds: [serum], from: "2026-09-01", to: "2026-09-30" } },
          { name: "get_notes", input: { search: "serum stock" } },
        );
      }
      const days = /"longestRun":\{[^}]*"days":(\d+)/.exec(s.results.find((r) => r.tool === "zero_sales_days")!.text)![1];
      return say(
        JSON.stringify({
          found: true,
          finding: `The Hero Vitamin C Serum had no sales for ${days} days in a row, from 2026-09-03 to 2026-09-13, while the supplier's batch was delayed.`,
          queryIds: [findQuery(s, "zero_sales_days"), findQuery(s, "get_notes")],
        }),
      );
    });
    const res = await explainGap(deps(model), { month: "2026-09" });
    const f = res.data.findings.find((x) => x.driverId === "2026-09:returning_customer_orders")!;
    expect(f.figures.counts).toEqual([11]);
    expect(f.untrusted.summary).toMatch(/Vitamin C Serum/);
    expect(f.evidence.find((e) => e.tool === "get_notes")!.notes).toEqual([{ heldOn: "2026-08-27", untrusted: { title: "Solenne x Growth Capital: supply check-in" } }]);
  });

  it("gives a client viewer's investigators store-data tools only", async () => {
    const offered = new Set<string>();
    const model = fakeModel((s) => {
      s.tools.forEach((t) => offered.add(t));
      return isSynthesis(s) ? say("x") : say('{"found": false}');
    });
    const res = await explainGap(deps(model, viewer), { month: "2026-10" });
    expect([...offered].sort()).toEqual(["get_inventory", "get_orders", "query_metric", "zero_sales_days"]);
    expect(res.data.noCauseFound).toBe(true);
    // and a Growth Capital role's investigators get the two extra tools
    offered.clear();
    await explainGap(deps(model, ctx), { month: "2026-10" });
    expect([...offered].sort()).toEqual(["get_calendar", "get_inventory", "get_notes", "get_orders", "query_metric", "zero_sales_days"]);
  });

  it("counts an investigator that fails, and still answers from the others", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        const s = seen(options as never);
        if (++calls === 1) throw new Error("boom");
        return isSynthesis(s) ? say("x") : say('{"found": false}');
      },
    });
    const res = await explainGap(deps(model), { month: "2026-10" }, { investigatorTimeoutMs: 5_000 });
    expect(res.meta.dropped.failed).toBe(1);
    expect(res.meta.investigators.filter((i) => i.outcome === "no_cause")).toHaveLength(2);
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
