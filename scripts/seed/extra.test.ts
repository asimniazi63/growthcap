import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildExtras, planExtra, runExtraCli, total } from "./extra.js";
import { Journal } from "./journal.js";
import { noLimit } from "./limiter.js";
import { loadStore } from "./load.js";
import { readDataset, selectRecords } from "./select.js";
import { createAdminClient } from "./shopify-admin.js";
import { createFakeShopify } from "./shopify-fake.test-util.js";

const base = readDataset("tidepool"); // the committed Tidepool dataset, as-of 2026-10-31
const solenneBase = readDataset("solenne");
const SHOP = "tidepool-test.myshopify.com";
const AFTER = Date.parse("2026-11-02T06:00:00Z"); // every extra order (1 Nov, Pacific and Eastern) is in the past
const BEFORE = Date.parse("2026-11-01T10:00:00Z");

describe("buildExtras", () => {
  it("builds the three Tidepool orders, dated 1 Nov store-local, tagged demo-extra and shipped free", () => {
    const { orders } = buildExtras("tidepool", base);
    expect(orders.map((o) => [o.genId, o.processedAt, total(o)])).toEqual([
      ["X_TP_001", "2026-11-01T10:15:00-08:00", 7400],
      ["X_TP_003", "2026-11-01T12:30:00-08:00", 6000],
      ["X_TP_002", "2026-11-01T15:40:00-08:00", 6800],
    ]);
    expect(orders.every((o) => o.shipping === 0 && o.discountCents === 0 && o.tags.includes("demo-extra"))).toBe(true);
    expect(orders[0]!.tags).toEqual(["channel:online_store", "demo-extra"]);
    expect(orders[1]!.tags).toEqual(["channel:tiktok", "demo-extra"]);
    expect(orders[2]!.tags).toEqual(["channel:instagram", "demo-extra"]);
  });

  it("uses today's catalog price for each line", () => {
    const { orders } = buildExtras("tidepool", base);
    for (const o of orders) for (const l of o.lines) expect(l.unitPrice).toBe(base.variants.find((v) => v.genId === l.variantGenId)!.price);
  });

  it("makes two new customers and reuses an existing one for the instagram order", () => {
    const { customers, orders } = buildExtras("tidepool", base);
    expect(customers).toEqual([
      { genId: "CUST_DEMO0001", persona: "regular" },
      { genId: "CUST_DEMO0002", persona: "regular" },
    ]);
    expect(base.customers.some((c) => c.genId === orders[2]!.customerGenId)).toBe(true);
    expect(base.orders.some((o) => o.customerGenId === orders[2]!.customerGenId)).toBe(true);
  });

  it("refuses a date on or before the end of the first load", () => {
    expect(() => buildExtras("tidepool", { ...base, asOf: "2026-11-01" })).toThrow(/would change history/);
  });

  it("builds three Solenne orders on 1 Nov Eastern time, after the clocks went back, from catalog variants", () => {
    const { orders, customers } = buildExtras("solenne", solenneBase);
    expect(orders.map((o) => [o.genId, o.processedAt, total(o)])).toEqual([
      ["X_SOL_001", "2026-11-01T11:05:00-05:00", 7600],
      ["X_SOL_002", "2026-11-01T14:30:00-05:00", 8400],
      ["X_SOL_003", "2026-11-01T19:20:00-05:00", 7200],
    ]);
    expect(orders.every((o) => o.shipping === 0 && o.discountCents === 0 && o.tags.includes("demo-extra"))).toBe(true);
    expect(customers.map((c) => c.genId)).toEqual(["CUST_DEMO0001", "CUST_DEMO0002"]);
    expect(solenneBase.orders.some((o) => o.customerGenId === orders[1]!.customerGenId)).toBe(true);
  });
});

describe("planExtra", () => {
  it("selects only the extra orders and their customers, and carries no stock rows", () => {
    const plan = planExtra("tidepool", base);
    expect(plan.selection.orders.map((o) => o.genId)).toEqual(["X_TP_001", "X_TP_003", "X_TP_002"]);
    expect(plan.selection.customers.map((c) => c.genId).sort()).toEqual(["CUST_DEMO0001", "CUST_DEMO0002", "CUST_c4d1ace7"]);
    expect(plan.selection.refunds).toEqual([]);
    expect(plan.dataset.inventory).toEqual([]);
  });
});

describe("extra orders against a fake Shopify", () => {
  const meta = { store: "tidepool" as const, shop: SHOP };

  it("creates three orders and two customers, touching no catalog record and no stock", async () => {
    const journal = Journal.open(null, meta);
    const fake = createFakeShopify();
    const client = createAdminClient({ shop: SHOP, clientId: "id", clientSecret: "secret", fetch: fake.fetch, sleep: async () => {} });
    await loadStore(base, selectRecords(base), { client, journal, orderLimiter: noLimit });
    const before = fake.calls.length;

    const plan = planExtra("tidepool", base);
    const result = await loadStore(plan.dataset, plan.selection, { client, journal, orderLimiter: noLimit });

    expect(result.failures).toEqual([]);
    expect(result.created).toEqual({ customer: 2, order: 3 });
    const mutations = fake.calls.slice(before).filter((c) => /mutation /.test(c.query));
    expect(mutations.map((c) => c.op)).toEqual(["SeedCustomerCreate", "SeedCustomerCreate", "SeedOrderCreate", "SeedOrderCreate", "SeedOrderCreate"]);
    const order = mutations[2]!.variables.order;
    expect(order).toMatchObject({ sourceIdentifier: "X_TP_001", processedAt: "2026-11-01T10:15:00-08:00", tags: ["channel:online_store", "demo-extra"] });
    expect(mutations[0]!.variables.input).toEqual({ email: "cust_demo0001@example.com" });
  });
});

describe("runExtraCli", () => {
  let dir: string;
  const logs: string[] = [];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "extra-"));
    logs.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const env = { TIDEPOOL_SHOP_DOMAIN: SHOP, SEEDER_CLIENT_ID: "a", SEEDER_CLIENT_SECRET: "b" };
  const deps = (nowMs: number, extra: object = {}) => ({ nowMs, log: (l: string) => logs.push(l), journalDir: dir, env, sleep: async () => {}, ...extra });

  it("a dry run lists the orders and flags the ones still in the future", async () => {
    expect(await runExtraCli(["--store", "tidepool", "--dry-run"], deps(BEFORE))).toBe(0);
    const out = logs.join("\n");
    expect(out).toMatch(/X_TP_001 {2}2026-11-01T10:15:00-08:00 {2}\$74\.00/);
    expect(out).toMatch(/\[still in the future\]/);
    expect(logs.at(-1)).toBe("Dry run: no network calls were made.");
  });

  it("a real run refuses while an order is still in the future, and says when to run it", async () => {
    expect(await runExtraCli(["--store", "tidepool"], deps(BEFORE))).toBe(2);
    expect(logs.join("\n")).toMatch(/X_TP_001, X_TP_003, X_TP_002 are dated in the future.*Run again after 2026-11-01T23:40:00\.000Z\. Nothing was created\./);
  });

  it("stops without the first load's journal", async () => {
    expect(await runExtraCli(["--store", "tidepool"], deps(AFTER))).toBe(2);
    expect(logs.join("\n")).toMatch(/No journal at .*tidepool\.json/);
  });

  it("creates the orders once: a second run finds them in the journal", async () => {
    const fake = createFakeShopify();
    const client = createAdminClient({ shop: SHOP, clientId: "id", clientSecret: "secret", fetch: fake.fetch, sleep: async () => {} });
    const journal = Journal.open(join(dir, "tidepool.json"), { store: "tidepool", shop: SHOP });
    await loadStore(base, selectRecords(base), { client, journal, orderLimiter: noLimit });
    const before = fake.calls.length;

    expect(await runExtraCli(["--store", "tidepool"], deps(AFTER, { fetch: fake.fetch }))).toBe(0);
    expect(logs.join("\n")).toMatch(/Created: orders 3, customers 2/);
    const created = fake.calls.slice(before).filter((c) => c.op === "SeedOrderCreate").length;
    expect(created).toBe(3);

    logs.length = 0;
    expect(await runExtraCli(["--store", "tidepool"], deps(AFTER, { fetch: fake.fetch }))).toBe(0);
    expect(logs.join("\n")).toMatch(/Created: orders 0, customers 0/);
    expect(fake.calls.filter((c) => c.op === "SeedOrderCreate")).toHaveLength(base.orders.length + 3);
  });
});
