import { describe, expect, it } from "vitest";
import { tinyDataset } from "../seed/dataset-fixture.test-util.js";
import { selectRecords } from "../seed/select.js";
import { ShopifyAdminError, explainAdminError } from "../seed/shopify-admin.js";
import { compare, runPilotCheck, toShopifyOrder, type ShopifyOrder } from "./pilot-check.js";

const ds = tinyDataset({ orders: 4, refundedOrderIndexes: [1] });
const sel = selectRecords(ds);
const skuOf = new Map(ds.variants.map((v) => [v.genId, v.sku]));

// What Shopify would hold if the loader did everything right.
function shopifyFrom(ds2 = ds): ShopifyOrder[] {
  return ds2.orders.map((o) => ({
    id: `gid://shopify/Order/${o.genId}`,
    sourceIdentifier: o.genId,
    processedAt: new Date(Date.parse(o.processedAt)).toISOString(), // Shopify answers in UTC
    tags: [...o.tags],
    test: false,
    discountCodes: o.discountCode ? [o.discountCode] : [],
    totalDiscounts: o.discountCents,
    shipping: o.shipping,
    lines: o.lines.map((l) => ({ sku: skuOf.get(l.variantGenId)!, qty: l.qty, unitPrice: l.unitPrice })),
    refunds: ds2.refunds
      .filter((r) => r.orderGenId === o.genId)
      .map((r) => ({ processedAt: new Date(Date.parse(r.processedAt)).toISOString(), lines: r.lines.map((l) => ({ sku: skuOf.get(l.variantGenId)!, qty: l.qty })) })),
  }));
}

const rowFor = (c: ReturnType<typeof compare>, id: string) => c.rows.find((r) => r.id === id)!;

describe("compare", () => {
  it("passes when Shopify holds exactly the dataset, even though it answers in UTC", () => {
    const c = compare(ds, sel, shopifyFrom());
    expect(c.ok).toBe(true);
    expect(c.rows.every((r) => r.status === "PASS")).toBe(true);
    expect(c.rows.map((r) => r.id)).toEqual(["O_00001", "O_00002", "R_00001", "O_00003", "O_00004"]);
    expect(c.counts).toMatchObject({ shopifyOrders: 4, expectedOrders: 4, matchedOrders: 4 });
  });

  it("fails an order whose processedAt moved, saying expected and actual", () => {
    const s = shopifyFrom();
    s[0]!.processedAt = "2026-10-31T00:00:00.000Z"; // the import time, as if processedAt was ignored
    const c = compare(ds, sel, s);
    expect(c.ok).toBe(false);
    expect(rowFor(c, "O_00001").problems.join(" ")).toMatch(/processedAt: expected 2025-09-01T14:00:00.000Z, got 2026-10-31T00:00:00.000Z/);
  });

  it("fails on a wrong line price, quantity, discount total, shipping or tag", () => {
    const s = shopifyFrom();
    s[0]!.totalDiscounts = 1;
    s[1]!.lines[0]!.unitPrice = 3200;
    s[2]!.lines[0]!.qty = 3;
    s[3]!.shipping = 999;
    s[3]!.tags = ["channel:tiktok"];
    const c = compare(ds, sel, s);
    expect(rowFor(c, "O_00001").problems.join(" ")).toMatch(/discount total: expected 6\.40, got 0\.01/);
    expect(rowFor(c, "O_00002").problems.join(" ")).toMatch(/lines/);
    expect(rowFor(c, "O_00003").problems.join(" ")).toMatch(/lines/);
    expect(rowFor(c, "O_00004").problems.join(" ")).toMatch(/shipping: expected 6\.00, got 9\.99/);
    expect(rowFor(c, "O_00004").problems.join(" ")).toMatch(/tags/);
  });

  it("fails an order that is a test order or carries a different discount code", () => {
    const s = shopifyFrom();
    s[0]!.test = true;
    s[0]!.discountCodes = ["OTHER"];
    const c = compare(ds, sel, s);
    expect(rowFor(c, "O_00001").problems.join(" ")).toMatch(/test order/);
    expect(rowFor(c, "O_00001").problems.join(" ")).toMatch(/discount code/);
  });

  it("fails an order Shopify doesn't have, and a duplicate", () => {
    const s = shopifyFrom().filter((o) => o.sourceIdentifier !== "O_00003");
    s.push({ ...s[0]! });
    const c = compare(ds, sel, s);
    expect(rowFor(c, "O_00003").problems).toEqual(["not found in Shopify"]);
    expect(rowFor(c, "O_00001").problems.join(" ")).toMatch(/2 orders with this sourceIdentifier/);
    expect(c.ok).toBe(false);
  });

  it("fails a refund with the wrong date, a missing refund, and an extra one", () => {
    const wrongDate = shopifyFrom();
    wrongDate[1]!.refunds[0]!.processedAt = "2026-10-31T00:00:00.000Z";
    expect(rowFor(compare(ds, sel, wrongDate), "R_00001").problems.join(" ")).toMatch(/no refund dated 2025-09-03T16:00:00.000Z/);
    const missing = shopifyFrom();
    missing[1]!.refunds = [];
    expect(rowFor(compare(ds, sel, missing), "R_00001").problems.join(" ")).toMatch(/not found/);
    const extra = shopifyFrom();
    extra[0]!.refunds = [{ processedAt: "2025-09-02T00:00:00.000Z", lines: [] }];
    expect(rowFor(compare(ds, sel, extra), "O_00001").problems.join(" ")).toMatch(/1 refund\(s\), dataset has 0/);
  });

  it("flags orders in Shopify that the dataset doesn't know, and ignores dataset orders outside a pilot selection", () => {
    const big = tinyDataset({ orders: 30 });
    const pilot = selectRecords(big, { limit: 3, extraRefunded: 0 });
    const s = shopifyFrom(big).slice(0, 3);
    expect(compare(big, pilot, s).ok).toBe(true);
    const stray = compare(big, pilot, [...s, { ...s[0]!, sourceIdentifier: null }, { ...s[0]!, sourceIdentifier: "SOMETHING_ELSE" }]);
    expect(stray.ok).toBe(false);
    expect(stray.unexpected).toHaveLength(2);
    expect(compare(big, pilot, [...s, ...shopifyFrom(big).slice(3, 5)]).ok).toBe(true); // loaded beyond the pilot: not wrong, just not checked
  });
});

describe("toShopifyOrder", () => {
  it("turns the GraphQL node's decimal strings into cents", () => {
    const o = toShopifyOrder({
      id: "gid://shopify/Order/1",
      sourceIdentifier: "O_00001",
      processedAt: "2025-09-01T14:00:00Z",
      tags: ["channel:online_store"],
      test: false,
      discountCodes: ["WELCOME10"],
      totalDiscountsSet: { shopMoney: { amount: "6.40" } },
      totalShippingPriceSet: { shopMoney: { amount: "0.00" } },
      lineItems: { nodes: [{ quantity: 2, sku: "LIP-FIG", originalUnitPriceSet: { shopMoney: { amount: "18.00" } } }] },
      refunds: [{ id: "r1", processedAt: "2025-09-03T16:00:00Z", refundLineItems: { nodes: [{ quantity: 1, lineItem: { sku: "CLN-001" } }] } }],
    });
    expect(o).toMatchObject({ totalDiscounts: 640, shipping: 0, lines: [{ sku: "LIP-FIG", qty: 2, unitPrice: 1800 }] });
    expect(o.refunds[0]).toEqual({ processedAt: "2025-09-03T16:00:00Z", lines: [{ sku: "CLN-001", qty: 1 }] });
  });
});

describe("runPilotCheck", () => {
  const env = { SOLENNE_SHOP_DOMAIN: "solenne-test.myshopify.com", SEEDER_CLIENT_ID: "id", SEEDER_CLIENT_SECRET: "secret" };

  function fetchWith(nodes: unknown[] | { denied: true }): typeof fetch {
    return (async (url: string | URL | Request) => {
      if (String(url).endsWith("/access_token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 86399 }));
      if ("denied" in (nodes as object)) {
        return new Response(JSON.stringify({ errors: [{ message: "This app is not approved to access the Order object.", extensions: { code: "ACCESS_DENIED" } }] }));
      }
      return new Response(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } }));
    }) as typeof fetch;
  }

  it("prints a PASS/FAIL table and exits nonzero on a mismatch", async () => {
    const logs: string[] = [];
    const nodes = [
      {
        id: "gid://shopify/Order/1", sourceIdentifier: "O_00001", processedAt: "2026-10-31T00:00:00Z", tags: ["channel:online_store"], test: false,
        discountCodes: ["WELCOME10"], totalDiscountsSet: { shopMoney: { amount: "6.40" } }, totalShippingPriceSet: { shopMoney: { amount: "0.00" } },
        lineItems: { nodes: [] }, refunds: [],
      },
    ];
    const code = await runPilotCheck(["--store", "solenne", "--limit", "1", "--extra-refunded", "0"], {
      env, fetch: fetchWith(nodes), log: (l) => logs.push(l), readDataset: () => tinyDataset({ orders: 3 }),
    });
    expect(code).toBe(1);
    expect(logs.join("\n")).toMatch(/FAIL\s+O_00001/);
    expect(logs.join("\n")).toMatch(/Orders in Shopify: 1/);
  });

  it("says plainly when Shopify won't let the app read orders (the deferred protected-data risk)", async () => {
    const logs: string[] = [];
    const code = await runPilotCheck(["--store", "solenne"], { env, fetch: fetchWith({ denied: true }), log: (l) => logs.push(l), readDataset: () => tinyDataset({ orders: 3 }) });
    expect(code).toBe(1);
    expect(logs.join("\n")).toMatch(/protected-customer-data risk/);
    expect(logs.join("\n")).not.toContain("secret");
  });
});

describe("explainAdminError", () => {
  it("explains an access_denied error and passes other errors through", () => {
    expect(explainAdminError(new ShopifyAdminError("nope", "access_denied"))).toMatch(/custom distribution/);
    expect(explainAdminError(new ShopifyAdminError("boom", "http", 503))).toBe("Shopify error (http 503): boom");
  });
});
