// Ground truth for a dataset. This is the independent check: it reads only the dataset and the metric
// definitions in product plan §8, and never imports from lib/metrics (which is built later, from the
// same definitions). Money is integer cents; rates are fractions.
import { STORES } from "./stores.js";
import type { CoreMetricId, Dataset, MetricId, Order, Storyline, StorylineCheck, Truth } from "./types.js";
import { addDays, localDate, monthOf } from "./time.js";
import { allocate, roundHalfUp } from "./money.js";

export type Filter = Record<string, string>;
export interface Period {
  from: string;
  to: string;
}

export interface StorylineSpec {
  id: string;
  from: string;
  to: string;
  entities: string[];
  finding: string;
  checks: { metric: MetricId; filter: Filter; period: Period; tolerance: number }[];
}

interface Index {
  variantProduct: Map<string, string>;
  orderById: Map<string, Order>;
  dateOf: Map<string, string>;
  firstOrderId: Map<string, string>;
  discountAlloc: Map<string, number[]>; // per order, per line
  refundedQty: Map<string, Map<string, number>>; // order -> variant -> qty
  ordersByCustomer: Map<string, Order[]>; // sorted by time
}

const cache = new WeakMap<Dataset, Index>();

function byTime(a: Order, b: Order): number {
  return a.processedAt < b.processedAt ? -1 : a.processedAt > b.processedAt ? 1 : a.genId < b.genId ? -1 : 1;
}

function indexOf(ds: Dataset): Index {
  const hit = cache.get(ds);
  if (hit) return hit;
  const idx: Index = {
    variantProduct: new Map(ds.variants.map((v) => [v.genId, v.productGenId])),
    orderById: new Map(),
    dateOf: new Map(),
    firstOrderId: new Map(),
    discountAlloc: new Map(),
    refundedQty: new Map(),
    ordersByCustomer: new Map(),
  };
  for (const o of [...ds.orders].sort(byTime)) {
    idx.orderById.set(o.genId, o);
    idx.dateOf.set(o.genId, localDate(o.processedAt));
    if (!idx.firstOrderId.has(o.customerGenId)) idx.firstOrderId.set(o.customerGenId, o.genId);
    const list = idx.ordersByCustomer.get(o.customerGenId) ?? [];
    list.push(o);
    idx.ordersByCustomer.set(o.customerGenId, list);
    idx.discountAlloc.set(o.genId, allocate(o.discountCents, o.lines.map((l) => l.qty * l.unitPrice)));
  }
  for (const r of ds.refunds) {
    const per = idx.refundedQty.get(r.orderGenId) ?? new Map<string, number>();
    for (const l of r.lines) per.set(l.variantGenId, (per.get(l.variantGenId) ?? 0) + l.qty);
    idx.refundedQty.set(r.orderGenId, per);
  }
  cache.set(ds, idx);
  return idx;
}

function orderPasses(idx: Index, o: Order, f: Filter): boolean {
  if (f.discount_code !== undefined && o.discountCode !== f.discount_code) return false;
  if (f.channel !== undefined && o.channel !== f.channel) return false;
  if (f.tag !== undefined && !o.tags.includes(f.tag)) return false;
  if (f.exclude_tag !== undefined && o.tags.includes(f.exclude_tag)) return false;
  if (f.customer_type !== undefined) {
    const isFirst = idx.firstOrderId.get(o.customerGenId) === o.genId;
    if ((f.customer_type === "new") !== isFirst) return false;
  }
  return true;
}

function lineMatches(idx: Index, variantGenId: string, f: Filter): boolean {
  if (f.variant !== undefined && variantGenId !== f.variant) return false;
  if (f.product !== undefined && idx.variantProduct.get(variantGenId) !== f.product) return false;
  return true;
}

interface Selected {
  order: Order;
  lines: number[]; // indexes of matching lines
}

function selectOrders(ds: Dataset, idx: Index, f: Filter, p: Period): Selected[] {
  const out: Selected[] = [];
  for (const o of ds.orders) {
    const d = idx.dateOf.get(o.genId) ?? localDate(o.processedAt);
    if (d < p.from || d > p.to || !orderPasses(idx, o, f)) continue;
    const lines: number[] = [];
    o.lines.forEach((l, i) => {
      if (lineMatches(idx, l.variantGenId, f)) lines.push(i);
    });
    if (lines.length > 0) out.push({ order: o, lines });
  }
  return out;
}

function lineNet(idx: Index, o: Order, i: number): number {
  const l = o.lines[i]!;
  return l.qty * l.unitPrice - (idx.discountAlloc.get(o.genId)?.[i] ?? 0);
}

function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}

function repeatRate(ds: Dataset, idx: Index, f: Filter, p: Period): number {
  const windowDays = Number(f.window_days ?? 30);
  let cohort = 0;
  let repeated = 0;
  for (const [customer, orders] of idx.ordersByCustomer) {
    const first = orders[0]!;
    const firstDate = localDate(first.processedAt);
    if (firstDate < p.from || firstDate > p.to) continue;
    if (idx.firstOrderId.get(customer) !== first.genId) continue;
    if (f.first_order_code !== undefined && first.discountCode !== f.first_order_code) continue;
    if (f.exclude_first_order_code !== undefined && first.discountCode === f.exclude_first_order_code) continue;
    if (f.exclude_tag !== undefined && first.tags.includes(f.exclude_tag)) continue;
    const horizon = addDays(firstDate, windowDays);
    if (horizon > ds.asOf) continue; // not observable for the whole window yet
    cohort++;
    if (orders.slice(1).some((o) => localDate(o.processedAt) <= horizon)) repeated++;
  }
  return cohort === 0 ? 0 : repeated / cohort;
}

function zeroSalesDays(ds: Dataset, idx: Index, f: Filter, p: Period): number {
  const perDay = new Map<string, number>();
  for (const o of ds.orders) {
    if (!orderPasses(idx, o, f)) continue;
    const d = idx.dateOf.get(o.genId) ?? localDate(o.processedAt);
    for (const l of o.lines) if (lineMatches(idx, l.variantGenId, f)) perDay.set(d, (perDay.get(d) ?? 0) + l.qty);
  }
  let count = 0;
  for (let d = p.from; d <= p.to; d = addDays(d, 1)) {
    if ((perDay.get(d) ?? 0) > 0) continue;
    let prior = 0;
    for (let k = 1; k <= 28; k++) prior += perDay.get(addDays(d, -k)) ?? 0;
    if (prior / 28 >= 0.5) count++;
  }
  return count;
}

// (net sales - unit cost x units kept) / net sales, using each variant's unit cost in the dataset (today's cost). Variants with
// no cost are left out of both parts. Units kept are the line's units less the units refunded on that order for that variant.
function grossMargin(ds: Dataset, idx: Index, f: Filter, p: Period): number {
  const cost = new Map(ds.variants.map((v) => [v.genId, v.unitCost as number | null | undefined]));
  const hasCost = (variantGenId: string) => cost.get(variantGenId) !== undefined && cost.get(variantGenId) !== null;
  let net = 0;
  let cogs = 0;
  for (const s of selectOrders(ds, idx, f, p)) {
    const per = idx.refundedQty.get(s.order.genId);
    for (const i of s.lines) {
      const l = s.order.lines[i]!;
      if (!hasCost(l.variantGenId)) continue;
      net += l.qty * l.unitPrice - (idx.discountAlloc.get(s.order.genId)?.[i] ?? 0);
      cogs += cost.get(l.variantGenId)! * Math.max(0, l.qty - (per?.get(l.variantGenId) ?? 0));
    }
  }
  for (const r of ds.refunds) {
    const d = localDate(r.processedAt);
    if (d < p.from || d > p.to) continue;
    const o = idx.orderById.get(r.orderGenId);
    if (!o || !orderPasses(idx, o, f)) continue;
    for (const rl of r.lines) {
      const i = o.lines.findIndex((l) => l.variantGenId === rl.variantGenId);
      if (i < 0 || !lineMatches(idx, rl.variantGenId, f) || !hasCost(rl.variantGenId)) continue;
      const l = o.lines[i]!;
      net -= rl.qty === l.qty ? lineNet(idx, o, i) : roundHalfUp((lineNet(idx, o, i) * rl.qty) / l.qty);
    }
  }
  return net <= 0 ? 0 : (net - cogs) / net;
}

export function metricValue(ds: Dataset, metric: MetricId, filter: Filter, period: Period): number {
  const idx = indexOf(ds);
  if (metric === "gross_margin") return grossMargin(ds, idx, filter, period);
  if (metric === "repeat_rate") return repeatRate(ds, idx, filter, period);
  if (metric === "zero_sales_days") return zeroSalesDays(ds, idx, filter, period);

  const selected = selectOrders(ds, idx, filter, period);
  const gross = sum(selected.flatMap((s) => s.lines.map((i) => s.order.lines[i]!.qty * s.order.lines[i]!.unitPrice)));
  const discounts = sum(selected.flatMap((s) => s.lines.map((i) => idx.discountAlloc.get(s.order.genId)?.[i] ?? 0)));
  const units = sum(selected.flatMap((s) => s.lines.map((i) => s.order.lines[i]!.qty)));
  const orders = selected.length;

  const refundAmount = (): number => {
    let total = 0;
    for (const r of ds.refunds) {
      const d = localDate(r.processedAt);
      if (d < period.from || d > period.to) continue;
      const o = idx.orderById.get(r.orderGenId);
      if (!o || !orderPasses(idx, o, filter)) continue;
      for (const rl of r.lines) {
        const i = o.lines.findIndex((l) => l.variantGenId === rl.variantGenId);
        if (i < 0 || !lineMatches(idx, rl.variantGenId, filter)) continue;
        const l = o.lines[i]!;
        total += rl.qty === l.qty ? lineNet(idx, o, i) : roundHalfUp((lineNet(idx, o, i) * rl.qty) / l.qty);
      }
    }
    return total;
  };

  switch (metric) {
    case "gross_sales":
      return gross;
    case "discounts":
      return discounts;
    case "refunds":
      return refundAmount();
    case "net_sales":
      return gross - discounts - refundAmount();
    case "orders":
      return orders;
    case "aov":
      return orders === 0 ? 0 : (gross - discounts) / orders;
    case "units":
      return units;
    case "new_customer_orders":
      return selected.filter((s) => idx.firstOrderId.get(s.order.customerGenId) === s.order.genId).length;
    case "returning_customer_rate": {
      const byCustomer = new Map<string, boolean>();
      for (const s of selected) {
        const returning = idx.firstOrderId.get(s.order.customerGenId) !== s.order.genId;
        byCustomer.set(s.order.customerGenId, (byCustomer.get(s.order.customerGenId) ?? false) || returning);
      }
      return byCustomer.size === 0 ? 0 : [...byCustomer.values()].filter(Boolean).length / byCustomer.size;
    }
    case "refund_rate": {
      let refunded = 0;
      for (const s of selected) {
        const per = idx.refundedQty.get(s.order.genId);
        for (const i of s.lines) refunded += per?.get(s.order.lines[i]!.variantGenId) ?? 0;
      }
      return units === 0 ? 0 : refunded / units;
    }
    case "discounted_order_share":
      return orders === 0 ? 0 : selected.filter((s) => s.order.discountCode !== undefined).length / orders;
  }
}

const CORE: CoreMetricId[] = [
  "gross_sales",
  "discounts",
  "refunds",
  "net_sales",
  "orders",
  "aov",
  "units",
  "new_customer_orders",
  "returning_customer_rate",
  "refund_rate",
  "discounted_order_share",
];

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number) as [number, number];
  const [ey, em] = to.slice(0, 7).split("-").map(Number) as [number, number];
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export function monthPeriod(month: string): Period {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${month}-01`, to: addDays(next, -1) };
}

/** Monthly values for every core metric, from the month of the first order to `through`'s month (default as-of). */
export function monthlyMetrics(ds: Dataset, filter: Filter = {}, through: string = ds.asOf): Record<string, Record<CoreMetricId, number>> {
  const first = ds.orders.reduce((min, o) => (localDate(o.processedAt) < min ? localDate(o.processedAt) : min), through);
  const out: Record<string, Record<CoreMetricId, number>> = {};
  for (const month of monthsBetween(first, through)) {
    const row = {} as Record<CoreMetricId, number>;
    for (const metric of CORE) row[metric] = metricValue(ds, metric, filter, monthPeriod(month));
    out[month] = row;
  }
  return out;
}

export function buildTruth(ds: Dataset, specs: StorylineSpec[]): Truth {
  const storylines: Storyline[] = specs.map((s) => ({
    id: s.id,
    from: s.from,
    to: s.to,
    entities: s.entities,
    finding: s.finding,
    checks: s.checks.map(
      (c): StorylineCheck => ({
        metric: c.metric,
        filter: c.filter,
        period: c.period,
        expected: metricValue(ds, c.metric, c.filter, c.period),
        tolerance: c.tolerance,
      }),
    ),
  }));
  return {
    store: ds.store,
    seed: ds.seed,
    asOf: ds.asOf,
    window: { from: STORES[ds.store].from, to: ds.asOf },
    monthly: monthlyMetrics(ds),
    storylines,
  };
}

export { monthOf };
