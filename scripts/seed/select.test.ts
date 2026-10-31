import { describe, expect, it } from "vitest";
import { tinyDataset } from "./dataset-fixture.test-util.js";
import { selectRecords } from "./select.js";

describe("selectRecords", () => {
  it("returns everything when there is no limit", () => {
    const ds = tinyDataset({ orders: 12, refundedOrderIndexes: [3, 10] });
    const sel = selectRecords(ds, {});
    expect(sel.orders).toHaveLength(12);
    expect(sel.refunds).toHaveLength(2);
    expect(sel.customers).toHaveLength(5);
  });

  it("takes the first N orders by processedAt, plus their refunds", () => {
    const ds = tinyDataset({ orders: 30, refundedOrderIndexes: [2, 4] });
    const sel = selectRecords(ds, { limit: 20, extraRefunded: 0 });
    expect(sel.orders.map((o) => o.genId)).toEqual(Array.from({ length: 20 }, (_, i) => `O_${String(i + 1).padStart(5, "0")}`));
    expect(sel.refunds.map((r) => r.orderGenId)).toEqual(["O_00003", "O_00005"]);
  });

  it("adds the first two refunded orders from beyond the limit so refunds get exercised", () => {
    const ds = tinyDataset({ orders: 30, refundedOrderIndexes: [25, 27, 28] });
    const sel = selectRecords(ds, { limit: 20 });
    expect(sel.orders).toHaveLength(22);
    expect(sel.orders.slice(20).map((o) => o.genId)).toEqual(["O_00026", "O_00028"]);
    expect(sel.refunds.map((r) => r.orderGenId)).toEqual(["O_00026", "O_00028"]);
  });

  it("does not add a refunded order twice when it is already inside the limit", () => {
    const ds = tinyDataset({ orders: 30, refundedOrderIndexes: [1, 25, 27] });
    const sel = selectRecords(ds, { limit: 20 });
    expect(sel.orders.map((o) => o.genId)).toContain("O_00002");
    expect(sel.orders).toHaveLength(22); // 20 + 2 extra: the first two refunded orders outside the limit are 26 and 28
    expect(new Set(sel.orders.map((o) => o.genId)).size).toBe(22);
  });

  it("keeps orders in processedAt order and only the customers they need", () => {
    const ds = tinyDataset({ orders: 30, refundedOrderIndexes: [25] });
    const sel = selectRecords(ds, { limit: 2, extraRefunded: 1 });
    const times = sel.orders.map((o) => Date.parse(o.processedAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(sel.customers.map((c) => c.genId)).toEqual(
      ds.customers.filter((c) => sel.orders.some((o) => o.customerGenId === c.genId)).map((c) => c.genId),
    );
  });
});
