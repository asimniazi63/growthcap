import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tinyDataset } from "./dataset-fixture.test-util.js";
import { Journal } from "./journal.js";
import { noLimit } from "./limiter.js";
import { idempotencyKey, loadStore, runCli, validateDataset, type LoadDeps } from "./load.js";
import { selectRecords } from "./select.js";
import { createAdminClient } from "./shopify-admin.js";
import { createFakeShopify, type FakeOptions } from "./shopify-fake.test-util.js";

const meta = { store: "solenne" as const, shop: "solenne-test.myshopify.com" };

function setup(fakeOpts: FakeOptions = {}, journal = Journal.open(null, meta), extra: Partial<LoadDeps> = {}) {
  const fake = createFakeShopify(fakeOpts);
  const client = createAdminClient({
    shop: meta.shop,
    clientId: "id",
    clientSecret: "secret",
    fetch: fake.fetch,
    sleep: async () => {},
  });
  const logs: string[] = [];
  const run = (ds = tinyDataset({ orders: 6, refundedOrderIndexes: [1, 3] }), limit?: number) =>
    loadStore(ds, selectRecords(ds, { limit }), { client, journal, orderLimiter: noLimit, log: (l) => logs.push(l), ...extra });
  return { fake, journal, run, logs };
}

describe("loadStore", () => {
  it("loads in dependency order and sets stock last, with an idempotency key", async () => {
    const { fake, run } = setup();
    const result = await run();
    expect(result.failures).toEqual([]);
    const ops = fake.calls.map((c) => c.op);
    const first = (op: string) => ops.indexOf(op);
    const order = ["SeedLocationAdd", "SeedCollectionCreate", "SeedProductSet", "SeedDiscountCreate", "SeedCustomerCreate", "SeedOrderCreate", "SeedRefundCreate", "SeedInventorySet"];
    for (let i = 1; i < order.length; i++) expect(first(order[i]!)).toBeGreaterThan(first(order[i - 1]!));
    expect(ops.at(-1)).toBe("SeedInventorySet");
    expect(fake.calls.find((c) => c.op === "SeedInventorySet")!.query).toMatch(/@idempotent\(key: "[0-9a-f-]{36}"\)/);
    expect(result.created).toMatchObject({ order: 6, refund: 2, customer: 5, product: 2, discount: 2, location: 2 });
  });

  it("sends each order the way the seeding plan requires", async () => {
    const { fake, run } = setup();
    await run();
    const order = fake.calls.find((c) => c.op === "SeedOrderCreate")!.variables;
    const o = order.order;
    expect(o).toMatchObject({
      sourceIdentifier: "O_00001",
      processedAt: "2025-09-01T10:00:00-04:00",
      test: false,
      tags: ["channel:online_store"],
      financialStatus: "PAID",
    });
    expect(o.lineItems).toEqual([
      expect.objectContaining({ quantity: 1, priceSet: { shopMoney: { amount: "28.00", currencyCode: "USD" } } }),
      expect.objectContaining({ quantity: 2, priceSet: { shopMoney: { amount: "18.00", currencyCode: "USD" } } }),
    ]);
    // O_00001 is above the free-shipping line and carries WELCOME10 (10% of 64.00, sent as the exact amount)
    expect(o.shippingLines).toBeUndefined();
    expect(o.discountCode).toEqual({ itemFixedDiscountCode: { code: "WELCOME10", amountSet: { shopMoney: { amount: "6.40", currencyCode: "USD" } } } });
    expect(o.transactions[0]).toMatchObject({ kind: "SALE", status: "SUCCESS", amountSet: { shopMoney: { amount: "57.60" } } });
    expect(o.customer.toAssociate.id).toMatch(/^gid:\/\/shopify\/Customer\//);
    expect(order.options).toEqual({ inventoryBehaviour: "BYPASS", sendReceipt: false, sendFulfillmentReceipt: false });
    for (const forbidden of ["email", "phone", "firstName", "lastName", "shippingAddress", "billingAddress"]) {
      expect(JSON.stringify(order)).not.toContain(`"${forbidden}"`);
    }
  });

  it("adds a shipping line below the free-shipping threshold and carries the note", async () => {
    const { fake, run } = setup();
    await run();
    const second = fake.calls.filter((c) => c.op === "SeedOrderCreate")[1]!.variables.order; // O_00002: 28.00 only
    expect(second.shippingLines).toEqual([
      expect.objectContaining({ title: "Standard shipping", priceSet: { shopMoney: { amount: "6.00", currencyCode: "USD" } } }),
    ]);
    expect(second.note).toBe("Gift wrap please");
  });

  it("creates customers from the id alone: an example.com address and nothing personal", async () => {
    const { fake, run } = setup();
    await run();
    const input = fake.calls.find((c) => c.op === "SeedCustomerCreate")!.variables.input;
    expect(input).toEqual({ email: "cust_00000001@example.com" });
  });

  it("a rerun skips every record the journal marks done", async () => {
    const { fake, run } = setup();
    await run();
    const before = fake.calls.length;
    const again = await run();
    const mutations = fake.calls.slice(before).filter((c) => /mutation /.test(c.query));
    expect(mutations).toEqual([]);
    expect(again.skipped).toMatchObject({ order: 6, refund: 2, customer: 5 });
    expect(again.created).toEqual({});
  });

  it("looks up an in-flight order and does not create it again when Shopify already has it", async () => {
    const journal = Journal.open(null, meta);
    const { fake, run } = setup({ existingOrders: ["O_00003"] }, journal);
    journal.markInflight("order", "O_00003"); // the loader died after Shopify answered, before the journal was written
    const result = await run();
    expect(fake.calls.filter((c) => c.op === "SeedOrderCreate").map((c) => c.variables.order.sourceIdentifier)).not.toContain("O_00003");
    expect(fake.calls.find((c) => c.op === "SeedOrderLookup")!.variables.q).toBe("source_identifier:O_00003");
    expect(journal.get("order", "O_00003")?.status).toBe("done");
    expect(result.recovered.order).toBe(1);
  });

  it("creates an in-flight order that Shopify does not have", async () => {
    const journal = Journal.open(null, meta);
    const { fake, run } = setup({}, journal);
    journal.markInflight("order", "O_00003");
    await run();
    expect(fake.calls.filter((c) => c.op === "SeedOrderCreate").map((c) => c.variables.order.sourceIdentifier)).toContain("O_00003");
    expect(fake.count("SeedOrderLookup")).toBe(1);
    expect(journal.get("order", "O_00003")?.status).toBe("done");
  });

  it("does not look orders up when nothing is in flight", async () => {
    const { fake, run } = setup();
    await run();
    expect(fake.count("SeedOrderLookup")).toBe(0);
  });

  it("does not journal an order that came back with userErrors, reports it, and carries on", async () => {
    const { fake, journal, run } = setup({ failOrders: ["O_00002"] });
    const result = await run();
    expect(journal.get("order", "O_00002")?.status).toBe("inflight");
    expect(journal.isDone("order", "O_00002")).toBe(false);
    expect(journal.isDone("order", "O_00003")).toBe(true);
    // the refund of the failed order can't be made, and says so instead of being skipped silently
    expect(result.failures).toEqual([
      { kind: "order", genId: "O_00002", messages: ["order.processedAt: is invalid"] },
      { kind: "refund", genId: "R_00001", messages: ["order O_00002 isn't in Shopify yet"] },
    ]);
    expect(fake.calls.filter((c) => c.op === "SeedRefundCreate")).toHaveLength(1);
  });

  it("waits and retries an order Shopify answers with 'Too many attempts', without counting a failure", async () => {
    const sleeps: number[] = [];
    const { fake, journal, run, logs } = setup({ throttleOrders: { O_00002: 2 } }, undefined, { sleep: async (ms) => void sleeps.push(ms) });
    const result = await run();
    expect(result.failures).toEqual([]);
    expect(result.aborted).toBe(false);
    expect(journal.isDone("order", "O_00002")).toBe(true);
    expect(fake.calls.filter((c) => c.op === "SeedOrderCreate" && c.variables.order.sourceIdentifier === "O_00002")).toHaveLength(3);
    expect(sleeps).toEqual([60_000, 60_000]);
    expect(logs.some((l) => /too many attempts/i.test(l) && l.includes("O_00002"))).toBe(true);
  });

  it("reports a throttle that never clears as a failure after the retries run out", async () => {
    const sleeps: number[] = [];
    const { fake, run } = setup({ throttleOrders: { O_00002: 99 } }, undefined, { sleep: async (ms) => void sleeps.push(ms), maxThrottleRetries: 3 });
    const result = await run();
    expect(result.failures[0]).toEqual({ kind: "order", genId: "O_00002", messages: ["Too many attempts. Please try again later."] });
    expect(fake.calls.filter((c) => c.op === "SeedOrderCreate" && c.variables.order.sourceIdentifier === "O_00002")).toHaveLength(4);
    expect(sleeps).toHaveLength(3);
  });

  it("stops after too many failures instead of repeating the same error a thousand times", async () => {
    const ds = tinyDataset({ orders: 12 });
    const failing = ds.orders.map((o) => o.genId);
    const { fake, run } = setup({ failOrders: failing });
    const result = await run(ds);
    expect(result.aborted).toBe(true);
    expect(fake.count("SeedOrderCreate")).toBe(5);
  });

  it("creates refunds from the journaled line item ids with notify off, the historical date and a stable key", async () => {
    const { fake, journal, run } = setup();
    await run();
    const refund = fake.calls.find((c) => c.op === "SeedRefundCreate")!;
    const orderEntry = journal.get("order", "O_00002")!;
    const lineItemId = (orderEntry.data as { lineItems: Record<string, string> }).lineItems["V_001"];
    expect(refund.variables.input).toEqual({
      orderId: orderEntry.shopifyId,
      notify: false,
      processedAt: "2025-09-03T12:00:00-04:00",
      note: "skin_reaction",
      refundLineItems: [{ lineItemId, quantity: 1, restockType: "NO_RESTOCK" }],
    });
    expect(refund.query).toContain(`@idempotent(key: "${idempotencyKey("solenne", "refund", "R_00001")}")`);
    expect(idempotencyKey("solenne", "refund", "R_00001")).toBe(idempotencyKey("solenne", "refund", "R_00001"));
    expect(idempotencyKey("solenne", "refund", "R_00001")).not.toBe(idempotencyKey("solenne", "refund", "R_00002"));
  });

  it("checks Shopify before re-creating an in-flight refund", async () => {
    const { fake, journal, run } = setup();
    await run();
    // forget the second refund as if the loader died right after Shopify created it
    journal.markInflight("refund", "R_00002");
    const before = fake.count("SeedRefundCreate");
    await run();
    expect(fake.count("SeedRefundLookup")).toBe(1);
    expect(fake.count("SeedRefundCreate")).toBe(before); // Shopify already had it
    expect(journal.isDone("refund", "R_00002")).toBe(true);
  });

  it("with a limit, loads the catalog in full but only the selected customers, orders and refunds", async () => {
    const ds = tinyDataset({ orders: 30, refundedOrderIndexes: [2, 26] });
    const { fake, run } = setup();
    const result = await run(ds, 3);
    expect(result.created).toMatchObject({ product: 2, discount: 2, location: 2, order: 4, refund: 2 });
    expect(fake.count("SeedOrderCreate")).toBe(4); // 3 + the refunded order beyond the limit
    expect(fake.count("SeedCustomerCreate")).toBeLessThanOrEqual(4);
  });
});

describe("validateDataset", () => {
  it("rejects an order that holds the same variant twice, since refunds couldn't tell its lines apart", () => {
    const ds = tinyDataset();
    ds.orders[0]!.lines.push({ variantGenId: "V_001", qty: 1, unitPrice: 2800 });
    expect(() => validateDataset(ds, selectRecords(ds))).toThrow(/O_00001.*V_001/);
  });
  it("rejects a line that points at an unknown variant", () => {
    const ds = tinyDataset();
    ds.orders[0]!.lines[0]!.variantGenId = "V_999";
    expect(() => validateDataset(ds, selectRecords(ds))).toThrow(/V_999/);
  });
});

describe("runCli", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "load-cli-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const env = { SOLENNE_SHOP_DOMAIN: "solenne-test.myshopify.com", SEEDER_CLIENT_ID: "id", SEEDER_CLIENT_SECRET: "secret" };

  it("--dry-run prints the plan and makes no network calls at all", async () => {
    const fake = createFakeShopify();
    const logs: string[] = [];
    const code = await runCli(["--store", "solenne", "--dry-run", "--limit", "3"], {
      env, fetch: fake.fetch, log: (l) => logs.push(l), readDataset: () => tinyDataset({ orders: 30, refundedOrderIndexes: [2, 26] }), journalDir: dir,
    });
    expect(code).toBe(0);
    expect(fake.calls).toHaveLength(0);
    expect(fake.tokenRequests).toBe(0);
    expect(logs.join("\n")).toMatch(/dry run/i);
    expect(logs.join("\n")).toMatch(/orders\s+4/);
  });

  it("refuses to run without --store", async () => {
    const fake = createFakeShopify();
    const logs: string[] = [];
    const code = await runCli([], { env, fetch: fake.fetch, log: (l) => logs.push(l), journalDir: dir });
    expect(code).toBe(2);
    expect(logs.join("\n")).toMatch(/--store/);
    expect(fake.calls).toHaveLength(0);
  });

  it("says which shop it is about to write to before the first call, and never prints the secret", async () => {
    const fake = createFakeShopify();
    const logs: string[] = [];
    const code = await runCli(["--store", "solenne", "--limit", "2", "--extra-refunded", "0"], {
      env, fetch: fake.fetch, log: (l) => logs.push(l), readDataset: () => tinyDataset({ orders: 4 }), journalDir: dir, sleep: async () => {},
    });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("This writes to solenne-test.myshopify.com");
    expect(logs.join("\n")).not.toContain("secret");
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.count("SeedOrderCreate")).toBe(2);
  });
});
