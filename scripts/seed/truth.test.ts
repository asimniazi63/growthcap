import { describe, expect, it } from "vitest";
import type { Dataset, Order } from "./types.js";
import { buildTruth, metricValue, monthlyMetrics } from "./truth.js";

function order(p: Partial<Order> & Pick<Order, "genId" | "processedAt" | "customerGenId" | "lines">): Order {
  return {
    shipping: 0,
    discountCents: 0,
    channel: "online_store",
    tags: ["channel:online_store"],
    ...p,
  };
}

function tiny(): Dataset {
  return {
    store: "solenne",
    asOf: "2026-03-31",
    seed: 1,
    collections: [],
    products: [
      { genId: "P_001", title: "A", description: "", collectionGenIds: [] },
      { genId: "P_002", title: "B", description: "", collectionGenIds: [] },
    ],
    variants: [
      { genId: "V_001", productGenId: "P_001", sku: "A1", title: "S", price: 1000, unitCost: 300 },
      { genId: "V_002", productGenId: "P_001", sku: "A2", title: "L", price: 2000, unitCost: 600 },
      { genId: "V_003", productGenId: "P_002", sku: "B1", title: "S", price: 500, unitCost: 100 },
    ],
    customers: [
      { genId: "CUST_a", persona: "regular" },
      { genId: "CUST_b", persona: "wholesale" },
    ],
    orders: [
      order({
        genId: "O_1",
        processedAt: "2026-01-05T10:00:00-05:00",
        customerGenId: "CUST_a",
        lines: [
          { variantGenId: "V_001", qty: 2, unitPrice: 1000 },
          { variantGenId: "V_003", qty: 1, unitPrice: 500 },
        ],
        discountCode: "TEN",
        discountCents: 250,
      }),
      order({
        genId: "O_2",
        processedAt: "2026-01-20T10:00:00-05:00",
        customerGenId: "CUST_a",
        lines: [{ variantGenId: "V_002", qty: 1, unitPrice: 2000 }],
      }),
      order({
        genId: "O_3",
        processedAt: "2026-02-03T10:00:00-05:00",
        customerGenId: "CUST_b",
        lines: [{ variantGenId: "V_003", qty: 2, unitPrice: 500 }],
        channel: "wholesale",
        tags: ["channel:wholesale", "wholesale"],
      }),
    ],
    refunds: [
      {
        genId: "R_1",
        orderGenId: "O_1",
        processedAt: "2026-01-12T12:00:00-05:00",
        lines: [{ variantGenId: "V_001", qty: 1 }],
        reason: "changed mind",
      },
    ],
    discounts: [],
    locations: [],
    inventory: [],
  };
}

const jan = { from: "2026-01-01", to: "2026-01-31" };
const feb = { from: "2026-02-01", to: "2026-02-28" };

describe("metricValue", () => {
  const ds = tiny();

  it("computes the store-level January metrics by hand", () => {
    expect(metricValue(ds, "gross_sales", {}, jan)).toBe(4500);
    expect(metricValue(ds, "discounts", {}, jan)).toBe(250);
    expect(metricValue(ds, "refunds", {}, jan)).toBe(900); // (2000 - 200 allocated discount) / 2 units
    expect(metricValue(ds, "net_sales", {}, jan)).toBe(3350);
    expect(metricValue(ds, "orders", {}, jan)).toBe(2);
    expect(metricValue(ds, "aov", {}, jan)).toBe(2125);
    expect(metricValue(ds, "units", {}, jan)).toBe(4);
    expect(metricValue(ds, "new_customer_orders", {}, jan)).toBe(1);
    expect(metricValue(ds, "returning_customer_rate", {}, jan)).toBe(1);
    expect(metricValue(ds, "refund_rate", {}, jan)).toBe(0.25);
    expect(metricValue(ds, "discounted_order_share", {}, jan)).toBe(0.5);
  });

  it("dates refunds by their own date but refund_rate by the order's date", () => {
    expect(metricValue(ds, "refunds", {}, { from: "2026-01-01", to: "2026-01-11" })).toBe(0);
    expect(metricValue(ds, "refund_rate", {}, { from: "2026-01-01", to: "2026-01-11" })).toBeCloseTo(1 / 3, 10); // 1 of O_1's 3 units
    expect(metricValue(ds, "refunds", {}, { from: "2026-01-12", to: "2026-01-12" })).toBe(900);
  });

  it("filters by product, taking only matching lines", () => {
    const f = { product: "P_001" };
    expect(metricValue(ds, "gross_sales", f, jan)).toBe(4000);
    expect(metricValue(ds, "discounts", f, jan)).toBe(200);
    expect(metricValue(ds, "refunds", f, jan)).toBe(900);
    expect(metricValue(ds, "net_sales", f, jan)).toBe(2900);
    expect(metricValue(ds, "units", f, jan)).toBe(3);
    expect(metricValue(ds, "refund_rate", f, jan)).toBeCloseTo(1 / 3, 10);
  });

  it("filters by order tags and can exclude wholesale", () => {
    expect(metricValue(ds, "orders", {}, feb)).toBe(1);
    expect(metricValue(ds, "orders", { exclude_tag: "wholesale" }, feb)).toBe(0);
    expect(metricValue(ds, "aov", { exclude_tag: "wholesale" }, feb)).toBe(0);
    expect(metricValue(ds, "orders", { discount_code: "TEN" }, jan)).toBe(1);
    expect(metricValue(ds, "orders", { customer_type: "returning" }, jan)).toBe(1);
  });

  it("computes repeat_rate for a first-order cohort", () => {
    expect(metricValue(ds, "repeat_rate", { window_days: "30" }, jan)).toBe(1);
    expect(metricValue(ds, "repeat_rate", { window_days: "10" }, jan)).toBe(0); // second order came on day 15
    expect(metricValue(ds, "repeat_rate", { window_days: "30", first_order_code: "TEN" }, jan)).toBe(1);
    expect(metricValue(ds, "repeat_rate", { window_days: "30", exclude_first_order_code: "TEN" }, jan)).toBe(0);
  });

  it("only counts cohort customers who have been observable for the whole window", () => {
    const late = tiny();
    late.asOf = "2026-01-30"; // 25 days after CUST_a's first order
    expect(metricValue(late, "repeat_rate", { window_days: "30" }, jan)).toBe(0);
  });

  it("counts zero_sales_days for a variant that normally sells at least 0.5 units a day", () => {
    const ds2 = tiny();
    ds2.orders = [];
    for (let d = 1; d <= 28; d++) {
      const day = `2026-01-${String(d).padStart(2, "0")}`;
      ds2.orders.push(
        order({ genId: `O_${d}`, processedAt: `${day}T10:00:00-05:00`, customerGenId: "CUST_a", lines: [{ variantGenId: "V_001", qty: 1, unitPrice: 1000 }] }),
      );
    }
    expect(metricValue(ds2, "zero_sales_days", { variant: "V_001" }, { from: "2026-01-29", to: "2026-01-31" })).toBe(3);
    expect(metricValue(ds2, "zero_sales_days", { variant: "V_003" }, { from: "2026-01-29", to: "2026-01-31" })).toBe(0);
  });
});

describe("monthlyMetrics and buildTruth", () => {
  it("has net_sales equal to gross_sales - discounts - refunds in every month", () => {
    const m = monthlyMetrics(tiny());
    expect(Object.keys(m)).toEqual(["2026-01", "2026-02", "2026-03"]);
    for (const row of Object.values(m)) expect(row.net_sales).toBe(row.gross_sales - row.discounts - row.refunds);
    expect(m["2026-01"]?.net_sales).toBe(3350);
    expect(m["2026-03"]?.orders).toBe(0);
  });

  it("measures each storyline check from the dataset", () => {
    const t = buildTruth(tiny(), [
      {
        id: "SX",
        from: "2026-01-01",
        to: "2026-01-31",
        entities: ["P_001"],
        finding: "a test finding",
        checks: [{ metric: "units", filter: { product: "P_001" }, period: jan, tolerance: 0 }],
      },
    ]);
    expect(t.store).toBe("solenne");
    expect(t.window).toEqual({ from: "2025-09-01", to: "2026-03-31" }); // the store's data window, not the first order
    expect(t.storylines[0]?.checks[0]?.expected).toBe(3);
  });
});
