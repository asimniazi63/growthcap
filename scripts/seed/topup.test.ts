import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tinyDataset } from "./dataset-fixture.test-util.js";
import { Journal } from "./journal.js";
import { noLimit } from "./limiter.js";
import { loadStore } from "./load.js";
import { selectRecords } from "./select.js";
import { createAdminClient } from "./shopify-admin.js";
import { createFakeShopify } from "./shopify-fake.test-util.js";
import { planTopup, runTopupCli, storeDate } from "./topup.js";
import type { Dataset } from "./types.js";

// The first load: five orders on 2025-09-01 and one refund (R_00001, 2025-09-03). The regenerated dataset adds two orders
// on 2025-09-02 and a refund of the first of them on 2025-09-04.
const base = (): Dataset => ({ ...tinyDataset({ orders: 5, refundedOrderIndexes: [1] }), asOf: "2025-09-01" });
const full = (): Dataset => ({ ...tinyDataset({ orders: 7, refundedOrderIndexes: [1, 5] }), asOf: "2025-09-04" });
const NY_NOON_SEP_4 = Date.parse("2025-09-04T16:00:00Z");

describe("storeDate", () => {
  it("is the store-local date, which can differ from the UTC date", () => {
    expect(storeDate(Date.parse("2026-11-01T10:35:00Z"), "America/New_York")).toBe("2026-11-01");
    expect(storeDate(Date.parse("2026-11-02T03:00:00Z"), "America/New_York")).toBe("2026-11-01"); // 22:00 on the 1st in New York
    expect(storeDate(Date.parse("2026-11-02T05:00:00Z"), "America/New_York")).toBe("2026-11-02");
    expect(storeDate(Date.parse("2026-11-02T07:59:00Z"), "America/Los_Angeles")).toBe("2026-11-01");
    expect(storeDate(Date.parse("2026-11-02T08:00:00Z"), "America/Los_Angeles")).toBe("2026-11-02");
  });
});

describe("planTopup", () => {
  it("selects the orders the first load does not have, with only the customers they need", () => {
    const plan = planTopup(base(), full(), { through: "2025-09-04", nowMs: NY_NOON_SEP_4 });
    expect(plan.selection.orders.map((o) => o.genId)).toEqual(["O_00006", "O_00007"]);
    expect(plan.selection.refunds.map((r) => r.genId)).toEqual(["R_00002"]);
    expect(plan.selection.customers.map((c) => c.genId)).toEqual(["CUST_00000001", "CUST_00000002"]);
    expect(plan.days).toEqual({ "2025-09-02": 2 });
  });

  it("never sets stock: the regenerated dataset carries no stock rows", () => {
    expect(planTopup(base(), full(), { through: "2025-09-04", nowMs: NY_NOON_SEP_4 }).dataset.inventory).toEqual([]);
  });

  it("stops at the last complete day", () => {
    const plan = planTopup(base(), full(), { through: "2025-09-01", nowMs: NY_NOON_SEP_4 });
    expect(plan.selection.orders).toEqual([]);
    expect(plan.selection.refunds).toEqual([]);
  });

  it("holds back a refund that is dated after now, even on a complete day", () => {
    const plan = planTopup(base(), full(), { through: "2025-09-04", nowMs: Date.parse("2025-09-04T10:00:00Z") }); // refund is 12:00 -04:00 = 16:00Z
    expect(plan.selection.orders).toHaveLength(2);
    expect(plan.selection.refunds).toEqual([]);
  });

  it("refuses when the generator no longer reproduces the first load's history", () => {
    const changed = full();
    changed.orders[2] = { ...changed.orders[2]!, shipping: 999 };
    expect(() => planTopup(base(), changed, { through: "2025-09-04", nowMs: NY_NOON_SEP_4 })).toThrow(/no longer reproduces order O_00003/);
  });

  it("refuses when the catalog differs from the first load", () => {
    const changed = full();
    changed.variants = changed.variants.map((v) => (v.genId === "V_001" ? { ...v, price: 3000 } : v));
    expect(() => planTopup(base(), changed, { through: "2025-09-04", nowMs: NY_NOON_SEP_4 })).toThrow(/catalog \(variants\) differs/);
  });
});

describe("topup against a fake Shopify", () => {
  const meta = { store: "solenne" as const, shop: "solenne-test.myshopify.com" };

  it("creates only the new orders and refunds, and touches no catalog record and no stock", async () => {
    const journal = Journal.open(null, meta);
    const fake = createFakeShopify();
    const client = createAdminClient({ shop: meta.shop, clientId: "id", clientSecret: "secret", fetch: fake.fetch, sleep: async () => {} });
    const first = base();
    await loadStore(first, selectRecords(first), { client, journal, orderLimiter: noLimit });
    const before = fake.calls.length;

    const plan = planTopup(first, full(), { through: "2025-09-04", nowMs: NY_NOON_SEP_4 });
    const result = await loadStore(plan.dataset, plan.selection, { client, journal, orderLimiter: noLimit });

    expect(result.failures).toEqual([]);
    expect(result.created).toEqual({ order: 2, refund: 1 });
    const mutations = fake.calls.slice(before).filter((c) => /mutation /.test(c.query)).map((c) => c.op);
    expect(mutations).toEqual(["SeedOrderCreate", "SeedOrderCreate", "SeedRefundCreate"]);
  });

  it("a second run loads nothing: the journal has every order", async () => {
    const journal = Journal.open(null, meta);
    const fake = createFakeShopify();
    const client = createAdminClient({ shop: meta.shop, clientId: "id", clientSecret: "secret", fetch: fake.fetch, sleep: async () => {} });
    const first = base();
    await loadStore(first, selectRecords(first), { client, journal, orderLimiter: noLimit });
    const plan = planTopup(first, full(), { through: "2025-09-04", nowMs: NY_NOON_SEP_4 });
    await loadStore(plan.dataset, plan.selection, { client, journal, orderLimiter: noLimit });
    const before = fake.calls.length;
    const again = await loadStore(plan.dataset, plan.selection, { client, journal, orderLimiter: noLimit });
    expect(again.created).toEqual({});
    expect(fake.calls.slice(before).filter((c) => /mutation /.test(c.query))).toEqual([]);
  });
});

describe("runTopupCli", () => {
  // The first load ends on 2026-10-31; the regenerated dataset adds two orders on 2026-11-01 (store-local, New York).
  const cliBase = (): Dataset => ({ ...base(), asOf: "2026-10-31" });
  const cliFull = (): Dataset => ({
    ...full(),
    asOf: "2026-11-01",
    orders: [...cliBase().orders, ...full().orders.slice(5).map((o) => ({ ...o, processedAt: "2026-11-01T10:00:00-05:00" }))],
    refunds: cliBase().refunds,
  });
  const env = { SOLENNE_SHOP_DOMAIN: "x.myshopify.com", SEEDER_CLIENT_ID: "a", SEEDER_CLIENT_SECRET: "b" };

  let dir: string;
  const logs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "topup-"));
    logs.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const deps = (nowIso: string) => ({ readDataset: cliBase, generate: cliFull, nowMs: Date.parse(nowIso), log: (l: string) => logs.push(l), journalDir: dir, env });

  it("says there is nothing to load while the first missing day is still today", async () => {
    // 10:35 UTC on 1 Nov is 05:35 in New York: complete days run through 31 Oct, which the first load already covers.
    expect(await runTopupCli(["--store", "solenne"], deps("2026-11-01T10:35:00Z"))).toBe(0);
    expect(logs.join("\n")).toMatch(/Solenne: nothing to load\. The first load runs through 2026-10-31; store-local today is 2026-11-01/);
  });

  it("a dry run lists the plan and makes no network call", async () => {
    // 06:00 UTC on 2 Nov is 01:00 in New York: 1 Nov is complete.
    expect(await runTopupCli(["--store", "solenne", "--dry-run"], deps("2026-11-02T06:00:00Z"))).toBe(0);
    const out = logs.join("\n");
    expect(out).toMatch(/Plan for Solenne: complete days 2026-11-01 to 2026-11-01/);
    expect(out).toMatch(/orders\s+2\s+\(2026-11-01: 2;/);
    expect(out).toMatch(/stock and catalog: untouched/);
    expect(logs.at(-1)).toBe("Dry run: no network calls were made.");
  });

  it("a preview with --through shows a day that is not complete yet", async () => {
    expect(await runTopupCli(["--store", "solenne", "--dry-run", "--through", "2026-11-01"], deps("2026-11-01T10:35:00Z"))).toBe(0);
    expect(logs.join("\n")).toMatch(/PREVIEW \(not loadable yet\) for Solenne/);
  });

  it("--through is only for dry runs", async () => {
    expect(await runTopupCli(["--store", "solenne", "--through", "2026-11-05"], deps("2026-11-02T06:00:00Z"))).toBe(2);
    expect(logs.join("\n")).toMatch(/only works with --dry-run/);
  });

  it("a real run without the first load's journal stops before any call", async () => {
    expect(await runTopupCli(["--store", "solenne"], deps("2026-11-02T06:00:00Z"))).toBe(2);
    expect(logs.join("\n")).toMatch(/No journal at .*solenne\.json/);
  });

  it("a real run refuses when the journal does not hold the whole first load", async () => {
    writeFileSync(join(dir, "solenne.json"), JSON.stringify({ store: "solenne", shop: "x.myshopify.com", entries: {} }));
    expect(await runTopupCli(["--store", "solenne"], deps("2026-11-02T06:00:00Z"))).toBe(2);
    expect(logs.join("\n")).toMatch(/records of the first load \(catalog or orders\) are not in Shopify yet/);
  });
});
