import { afterAll, describe, expect, it } from "vitest";
import { checkClaims, ledgerFromToolResults } from "../lib/agent/checker";
import { setTestNow } from "../lib/clock";
import { tenants } from "../lib/db/schema";
import { createTestDb } from "../lib/db/test-db";
import { playbookQuestion } from "../lib/playbooks/definitions";
import type { TenantContext } from "../lib/tenancy/context";
import { getEbitdaScenario } from "../lib/tools/ebitda-scenario";
import { loadCostAssumptions, loadCosts } from "../scripts/fixtures/load-costs";
import { loadDataset, readFixture } from "../scripts/fixtures/load-db";
import { loadAdSpend, readFixtureFile } from "../scripts/fixtures/load-pace";
import { STORES } from "../scripts/seed/stores.js";
import type { EvalEnv } from "./cases";
import { whatIfBase, whatIfMargins } from "./t23-cases";

// The Creative briefs case expects the what-ifs' profit margins (EBITDA as a share of net sales) that whatIfMargins() works out from the
// fixture files and the engine's pure arithmetic, without the database or the tools. This is the check of that derivation: it loads the
// same fixture the eval loads, asks the real what-if tool the two questions the playbook asks, and wants the same base, the same margins,
// the field names the question names, and a number checker that accepts the margins written as percentages and refuses them as dollars.
// It needs the database, so it runs with the others that do (one at a time).

afterAll(() => setTestNow(null));

describe("the what-if margins the Creative briefs eval expects", () => {
  it("are what the tool returns for the loaded fixture, in the fields the question names, and the checker takes them as percentages", async () => {
    setTestNow("2026-11-02T12:00:00-05:00"); // the clock of creative-briefs-black-friday: the last three complete months are August to October
    const db = await createTestDb();
    const [tenant] = await db.insert(tenants).values({ orgId: "org_solenne", name: STORES.solenne.name }).returning();
    const fx = readFixture("solenne");
    await loadDataset(db, tenant!.id, "solenne", fx.dataset);
    await loadAdSpend(db, tenant!.id, readFixtureFile("solenne", "ad-spend.csv"));
    await loadCosts(db, tenant!.id, readFixtureFile("solenne", "costs.csv"));
    await loadCostAssumptions(db, tenant!.id, readFixtureFile("solenne", "cost-assumptions.csv"));
    const ctx: TenantContext = { tenantId: tenant!.id, orgId: "org_solenne", userId: "eval", role: "gc_admin", shop: { domain: "solenne.myshopify.com", timezone: STORES.solenne.timezone, currency: "USD", status: "connected" } };
    const env = { store: "solenne", ...fx } as EvalEnv;

    const ten = await getEbitdaScenario(ctx, { months: 3, priceChange: -0.1 }, { db });
    const twentyFive = await getEbitdaScenario(ctx, { months: 3, priceChange: -0.25 }, { db });

    // The base, line by line, as the tool read it from the database and as the eval works it out from the files.
    const base = whatIfBase(env);
    expect(ten.data.baselineMonths).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(ten.data.baseline).toMatchObject({ netSalesCents: base.netSalesCents, costOfGoodsCents: base.costOfGoodsCents, adSpendCents: base.adSpendCents, operatingCostsCents: base.operatingCostsCents, orders: base.orders });

    // The margins, at the baseline and at each price cut, to the last digit of a float.
    const expected = whatIfMargins(env);
    expect(ten.data.baseline.ebitdaRate! * 100).toBeCloseTo(expected.baseline, 9);
    expect(twentyFive.data.baseline.ebitdaRate! * 100).toBeCloseTo(expected.baseline, 9);
    expect(ten.data.scenario.ebitdaRate! * 100).toBeCloseTo(expected.tenOff, 9);
    expect(twentyFive.data.scenario.ebitdaRate! * 100).toBeCloseTo(expected.twentyFiveOff, 9);

    // The question names these two paths of a result, so they have to exist there as fractions.
    const q = playbookQuestion("creative-briefs", {}, new Date("2026-11-02T12:00:00-05:00"));
    expect(q).toContain("baseline.ebitdaRate, then scenario.ebitdaRate");
    for (const path of ["baseline.ebitdaRate", "scenario.ebitdaRate"]) expect(ten.data, path).toHaveProperty(path);
    expect(ten.data.baseline.ebitdaRate).toBeGreaterThan(0);
    expect(ten.data.baseline.ebitdaRate).toBeLessThan(1);

    // The number checker accepts the margins as percentages, rounded as a model writes them, and refuses the money from the same results.
    const ledger = ledgerFromToolResults([ten, twentyFive]);
    const inputs = [{ months: 3, priceChange: -0.1 }, { months: 3, priceChange: -0.25 }];
    const margins = `The profit margin falls from ${expected.baseline.toFixed(1)}% to ${expected.tenOff.toFixed(1)}% at ten percent off and to ${expected.twentyFiveOff.toFixed(1)}% at twenty-five percent off.`;
    expect(checkClaims(margins, ledger, inputs)).toMatchObject({ ok: true, unmatched: [] });
    expect(checkClaims("The profit margin falls from 16% to 14% at ten percent off and to 7% at twenty-five percent off.", ledger, inputs).ok).toBe(true);
    const cents = `A twenty-five percent price cut takes monthly EBITDA from $${ten.data.baselineEbitdaPerMonthCents.toLocaleString("en-US")} to $${twentyFive.data.scenarioEbitdaPerMonthCents.toLocaleString("en-US")}.`;
    expect(checkClaims(cents, ledger, inputs).ok).toBe(false); // the cents written as dollars, which four of six live runs did
  }, 120_000);
});
