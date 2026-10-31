import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Customer, Dataset, Order, Refund, StoreKey } from "./types.js";

export interface Selection {
  orders: Order[];
  refunds: Refund[];
  customers: Customer[];
}

export interface SelectOptions {
  limit?: number; // the pilot: the first N orders by processedAt
  extraRefunded?: number; // plus this many refunded orders from outside the first N (default 2)
}

const byTimeThenId = <T extends { processedAt: string; genId: string }>(a: T, b: T) =>
  Date.parse(a.processedAt) - Date.parse(b.processedAt) || a.genId.localeCompare(b.genId);

// What a run loads. Without a limit that's the whole dataset. With a limit (the pilot) it's the first N orders
// plus the first `extraRefunded` refunded orders found later, so refunds are exercised even though few of the
// earliest orders are refunded. The catalog (locations, collections, products, variants, discounts) is always
// loaded in full by the loader: it's small. Customers are only the ones the selected orders need.
export function selectRecords(ds: Dataset, opts: SelectOptions = {}): Selection {
  const sortedOrders = [...ds.orders].sort(byTimeThenId);
  const sortedRefunds = [...ds.refunds].sort(byTimeThenId);
  let orders = sortedOrders;
  if (opts.limit !== undefined) {
    const first = sortedOrders.slice(0, opts.limit);
    const chosen = new Set(first.map((o) => o.genId));
    const extra: string[] = [];
    for (const r of sortedRefunds) {
      if (extra.length >= (opts.extraRefunded ?? 2)) break;
      if (!chosen.has(r.orderGenId) && !extra.includes(r.orderGenId)) extra.push(r.orderGenId);
    }
    const extraSet = new Set(extra);
    orders = sortedOrders.filter((o) => chosen.has(o.genId) || extraSet.has(o.genId));
  }
  const orderIds = new Set(orders.map((o) => o.genId));
  const customerIds = new Set(orders.map((o) => o.customerGenId));
  return {
    orders,
    refunds: sortedRefunds.filter((r) => orderIds.has(r.orderGenId)),
    customers: ds.customers.filter((c) => customerIds.has(c.genId)),
  };
}

export function readDataset(store: StoreKey, root = process.cwd()): Dataset {
  const path = join(root, "fixtures", store, "dataset.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Dataset;
  } catch (e) {
    throw new Error(`Can't read ${path}: ${(e as Error).message}. Has the generator written it yet (npm run seed:generate)?`);
  }
}
