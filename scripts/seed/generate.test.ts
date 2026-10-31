import { beforeAll, describe, expect, it } from "vitest";
import { AS_OF, SEED, STORES } from "./stores.js";
import type { Dataset, StoreKey } from "./types.js";
import { addDays, daysBetween, localDate, localIso } from "./time.js";
import { metricValue } from "./truth.js";
import { adSpendRows, datasetHash, generateDataset, planRows, storylineSpecs } from "./generate.js";

const sol = { on: undefined as unknown as Dataset, off: undefined as unknown as Dataset };
const tp = { on: undefined as unknown as Dataset, off: undefined as unknown as Dataset };

beforeAll(() => {
  sol.on = generateDataset("solenne", { asOf: AS_OF, storylines: true });
  sol.off = generateDataset("solenne", { asOf: AS_OF, storylines: false });
  tp.on = generateDataset("tidepool", { asOf: AS_OF, storylines: true });
  tp.off = generateDataset("tidepool", { asOf: AS_OF, storylines: false });
});

const product = (ds: Dataset, title: string) => {
  const p = ds.products.find((x) => x.title === title);
  if (!p) throw new Error(`no product ${title}`);
  return p;
};
const variantOf = (ds: Dataset, productTitle: string, variantTitle: string) => {
  const pid = product(ds, productTitle).genId;
  const v = ds.variants.find((x) => x.productGenId === pid && x.title === variantTitle);
  if (!v) throw new Error(`no variant ${productTitle}/${variantTitle}`);
  return v;
};
const serumFamily = (ds: Dataset) =>
  ds.products.filter((p) => /Vitamin C Serum/.test(p.title)).map((p) => p.genId);

const sd = (xs: number[]) => {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
};
/** Natural variation: the spread of the same measure over same-length windows of the storylines-off run. */
function naturalSd(ds: Dataset, measure: (from: string, to: string) => number, len: number): number {
  const vals: number[] = [];
  for (let s = "2026-02-01"; addDays(s, len - 1) <= "2026-10-31"; s = addDays(s, 7)) vals.push(measure(s, addDays(s, len - 1)));
  return sd(vals);
}

describe("determinism", () => {
  it("gives the same dataset hash for the same seed and as-of, and a different one for another seed", () => {
    expect(datasetHash(generateDataset("tidepool", { asOf: AS_OF, storylines: true }))).toBe(datasetHash(tp.on));
    expect(datasetHash(generateDataset("tidepool", { asOf: AS_OF, storylines: true, seed: 7 }))).not.toBe(datasetHash(tp.on));
  });

  it("keeps history identical when as-of is earlier (also when it falls inside a storyline window)", () => {
    for (const cut of ["2026-03-31", "2026-06-15", "2026-09-08"]) {
      const early = generateDataset("solenne", { asOf: cut, storylines: true });
      expect(early.orders).toEqual(sol.on.orders.filter((o) => localDate(o.processedAt) <= cut));
      expect(early.refunds).toEqual(sol.on.refunds.filter((r) => localDate(r.processedAt) <= cut));
      const firstDate = new Map<string, string>();
      for (const o of sol.on.orders) if (!firstDate.has(o.customerGenId)) firstDate.set(o.customerGenId, localDate(o.processedAt));
      expect(early.customers).toEqual(sol.on.customers.filter((c) => (firstDate.get(c.genId) ?? "9999") <= cut));
    }
  });
});

describe("scale and shape", () => {
  it("Solenne: 28 products, about 65 variants, 6 collections, 12 codes, 2 locations, about 1,000 orders", () => {
    const d = sol.on;
    expect(d.products).toHaveLength(28);
    expect(d.variants.length).toBeGreaterThanOrEqual(55);
    expect(d.variants.length).toBeLessThanOrEqual(75);
    expect(d.collections).toHaveLength(6);
    expect(d.discounts).toHaveLength(12);
    expect(d.locations).toHaveLength(2);
    expect(d.orders.length).toBeGreaterThanOrEqual(900);
    expect(d.orders.length).toBeLessThanOrEqual(1100);
    expect(d.variants.every((v) => v.unitCost > 0 && v.unitCost < v.price)).toBe(true);
    expect(d.products.some((p) => /gift card/i.test(p.title))).toBe(false);
    expect(d.customers.filter((c) => c.persona === "wholesale")).toHaveLength(2);
    expect(d.customers.every((c) => /^CUST_[0-9a-f]{8}$/.test(c.genId))).toBe(true);
  });

  it("Solenne: about 6% of orders are refunded, personas are mixed, and every order has a channel tag", () => {
    const d = sol.on;
    const refundedOrders = new Set(d.refunds.map((r) => r.orderGenId)).size;
    expect(refundedOrders / d.orders.length).toBeGreaterThan(0.045);
    expect(refundedOrders / d.orders.length).toBeLessThan(0.085);
    const personas = new Set(d.customers.map((c) => c.persona));
    for (const p of ["loyalist", "regular", "one_and_done", "deal_seeker", "gifter", "wholesale"] as const) expect(personas.has(p)).toBe(true);
    expect(d.orders.every((o) => o.tags.includes(`channel:${o.channel}`))).toBe(true);
    const shipped = d.orders.filter((o) => o.shipping > 0).length;
    expect(shipped).toBeGreaterThan(0);
  });

  it("Tidepool: 12 products, about 100 orders", () => {
    expect(tp.on.products).toHaveLength(12);
    expect(tp.on.orders.length).toBeGreaterThanOrEqual(85);
    expect(tp.on.orders.length).toBeLessThanOrEqual(125);
  });

  it("starts each store on its first data day and never goes past as-of", () => {
    for (const [key, d] of [["solenne", sol.on], ["tidepool", tp.on]] as [StoreKey, Dataset][]) {
      const dates = d.orders.map((o) => localDate(o.processedAt));
      expect(dates[0]! >= STORES[key].from).toBe(true);
      expect(daysBetween(STORES[key].from, dates[0]!)).toBeLessThan(4);
      expect(dates[dates.length - 1]! <= AS_OF).toBe(true);
      expect(d.asOf).toBe(AS_OF);
      expect(d.seed).toBe(SEED);
    }
  });
});

describe("referential integrity", () => {
  it.each([["solenne"], ["tidepool"]] as [StoreKey][])("%s: every id resolves and refunds make sense", (key) => {
    const d = key === "solenne" ? sol.on : tp.on;
    const variants = new Set(d.variants.map((v) => v.genId));
    const customers = new Set(d.customers.map((c) => c.genId));
    const orders = new Map(d.orders.map((o) => [o.genId, o]));
    expect(new Set(d.orders.map((o) => o.genId)).size).toBe(d.orders.length);
    expect(new Set(d.refunds.map((r) => r.genId)).size).toBe(d.refunds.length);
    expect(new Set(d.customers.map((c) => c.genId)).size).toBe(d.customers.length);
    const codes = new Set(d.discounts.map((x) => x.code));
    for (const o of d.orders) {
      expect(customers.has(o.customerGenId)).toBe(true);
      expect(o.lines.length).toBeGreaterThan(0);
      expect(new Set(o.lines.map((l) => l.variantGenId)).size).toBe(o.lines.length);
      for (const l of o.lines) {
        expect(variants.has(l.variantGenId)).toBe(true);
        expect(l.qty).toBeGreaterThan(0);
      }
      if (o.discountCode) expect(codes.has(o.discountCode)).toBe(true);
      else expect(o.discountCents).toBe(0);
    }
    for (const r of d.refunds) {
      const o = orders.get(r.orderGenId);
      expect(o).toBeDefined();
      expect(r.processedAt >= o!.processedAt).toBe(true);
      for (const l of r.lines) {
        const ordered = o!.lines.find((x) => x.variantGenId === l.variantGenId);
        expect(ordered).toBeDefined();
        expect(l.qty).toBeGreaterThan(0);
        expect(l.qty).toBeLessThanOrEqual(ordered!.qty);
      }
    }
    const refundedPerOrder = new Map<string, number>();
    for (const r of d.refunds) for (const l of r.lines) refundedPerOrder.set(`${r.orderGenId}|${l.variantGenId}`, (refundedPerOrder.get(`${r.orderGenId}|${l.variantGenId}`) ?? 0) + l.qty);
    for (const [k, q] of refundedPerOrder) {
      const [oid, vid] = k.split("|");
      expect(q).toBeLessThanOrEqual(orders.get(oid!)!.lines.find((l) => l.variantGenId === vid)!.qty);
    }
    for (const inv of d.inventory) {
      expect(variants.has(inv.variantGenId)).toBe(true);
      expect(d.locations.some((l) => l.genId === inv.locationGenId)).toBe(true);
      expect(inv.available).toBeGreaterThanOrEqual(0);
    }
    expect(d.orders.map((o) => o.processedAt)).toEqual([...d.orders.map((o) => o.processedAt)].sort());
  });
});

describe("timestamps carry the store's UTC offset", () => {
  it.each([["solenne"], ["tidepool"]] as [StoreKey][])("%s: every offset matches the date, with edge cases present", (key) => {
    const d = key === "solenne" ? sol.on : tp.on;
    const tz = STORES[key].timezone;
    for (const o of d.orders) {
      const hh = Number(o.processedAt.slice(11, 13));
      const mm = Number(o.processedAt.slice(14, 16));
      expect(o.processedAt).toBe(localIso(tz, localDate(o.processedAt), hh, mm, Number(o.processedAt.slice(17, 19))));
    }
    const lastOfMonthLate = d.orders.some((o) => {
      const date = localDate(o.processedAt);
      return addDays(date, 1).endsWith("-01") && Number(o.processedAt.slice(11, 13)) === 23;
    });
    const firstOfMonthEarly = d.orders.some((o) => localDate(o.processedAt).endsWith("-01") && Number(o.processedAt.slice(11, 13)) === 0);
    expect(lastOfMonthLate).toBe(true);
    expect(firstOfMonthEarly).toBe(true);
  });

  it("Solenne has orders on both DST change days, with the right offsets", () => {
    const on = (day: string) => sol.on.orders.filter((o) => localDate(o.processedAt) === day);
    expect(on("2025-11-02").length).toBeGreaterThan(0);
    expect(on("2026-03-08").length).toBeGreaterThan(0);
    expect(on("2025-11-01").every((o) => o.processedAt.endsWith("-04:00"))).toBe(true);
    expect(on("2025-11-03").every((o) => o.processedAt.endsWith("-05:00"))).toBe(true);
    expect(on("2026-03-07").every((o) => o.processedAt.endsWith("-05:00"))).toBe(true);
    expect(on("2026-03-09").every((o) => o.processedAt.endsWith("-04:00"))).toBe(true);
  });
});

describe("storylines (Solenne)", () => {
  const m = (metric: Parameters<typeof metricValue>[1], filter: Record<string, string>, from: string, to: string, d = sol.on) =>
    metricValue(d, metric, filter, { from, to });

  it("S3: one $6,000 wholesale order on 2026-05-14 inflates May AOV unless wholesale is excluded", () => {
    const w = sol.on.orders.filter((o) => o.tags.includes("wholesale") && localDate(o.processedAt) === "2026-05-14");
    expect(w).toHaveLength(1);
    expect(w[0]!.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)).toBe(600000);
    const withW = m("aov", {}, "2026-05-01", "2026-05-31");
    const withoutW = m("aov", { exclude_tag: "wholesale" }, "2026-05-01", "2026-05-31");
    expect(withW / withoutW).toBeGreaterThan(1.5);
    // 2.5x natural variation: May AOV against the spread of monthly AOV on the storylines-off run
    const monthly: number[] = [];
    for (const mo of ["2026-02", "2026-03", "2026-04", "2026-06", "2026-07", "2026-08", "2026-09"]) monthly.push(m("aov", {}, `${mo}-01`, `${mo}-28`, sol.off));
    expect(withW - m("aov", {}, "2026-05-01", "2026-05-31", sol.off)).toBeGreaterThan(2.5 * sd(monthly));
  });

  it("S4: Barrier Cream refund rate is 15-21% from 06-08 to 06-28, against about 4% otherwise, all 'skin reaction'", () => {
    const bc = product(sol.on, "Barrier Cream").genId;
    const inWindow = m("refund_rate", { product: bc }, "2026-06-08", "2026-06-28");
    expect(m("units", { product: bc }, "2026-06-08", "2026-06-28")).toBeGreaterThanOrEqual(18);
    expect(inWindow).toBeGreaterThanOrEqual(0.15);
    expect(inWindow).toBeLessThanOrEqual(0.21);
    const baseline = m("refund_rate", { product: bc }, "2025-09-01", "2026-06-07");
    expect(baseline).toBeGreaterThan(0.01);
    expect(baseline).toBeLessThan(0.08);
    const bcVariants = new Set(sol.on.variants.filter((v) => v.productGenId === bc).map((v) => v.genId));
    const orders = new Map(sol.on.orders.map((o) => [o.genId, o]));
    const windowRefunds = sol.on.refunds.filter((r) => {
      const od = localDate(orders.get(r.orderGenId)!.processedAt);
      return od >= "2026-06-08" && od <= "2026-06-28" && r.lines.some((l) => bcVariants.has(l.variantGenId));
    });
    expect(windowRefunds.length).toBeGreaterThan(0);
    expect(windowRefunds.every((r) => r.reason === "skin reaction")).toBe(true);
    const effect = inWindow - m("refund_rate", { product: bc }, "2026-06-08", "2026-06-28", sol.off);
    const variation = naturalSd(sol.off, (f, t) => m("refund_rate", { product: bc, exclude_tag: "wholesale" }, f, t, sol.off), 21);
    expect(effect).toBeGreaterThan(2.5 * variation);
  });

  it("S5: Fig goes about 6x baseline on 07-10, sells nothing 07-19 to 08-04, and sells again from 08-05", () => {
    const fig = variantOf(sol.on, "Lip Tint", "Fig").genId;
    const base = m("units", { variant: fig }, "2025-09-01", "2026-07-09") / daysBetween("2025-09-01", "2026-07-09");
    const viral = m("units", { variant: fig }, "2026-07-10", "2026-07-18");
    const ratio = viral / (base * 9);
    expect(ratio).toBeGreaterThanOrEqual(3.5);
    expect(ratio).toBeLessThanOrEqual(9);
    expect(m("units", { variant: fig }, "2026-07-19", "2026-08-04")).toBe(0);
    expect(m("units", { variant: fig }, "2026-08-05", "2026-08-31")).toBeGreaterThan(0);
    const offViral = m("units", { variant: fig }, "2026-07-10", "2026-07-18", sol.off);
    const variation = naturalSd(sol.off, (f, t) => m("units", { variant: fig, exclude_tag: "wholesale" }, f, t, sol.off), 9);
    expect(viral - offViral).toBeGreaterThan(2.5 * variation);
  });

  it("S6: about 70% of VIPGLOW25 redemptions in the leak are first-time buyers, who rarely come back", () => {
    const codeOrders = m("orders", { discount_code: "VIPGLOW25" }, "2026-08-04", "2026-08-31");
    const firstTime = m("orders", { discount_code: "VIPGLOW25", customer_type: "new" }, "2026-08-04", "2026-08-31");
    expect(firstTime / codeOrders).toBeGreaterThanOrEqual(0.65);
    expect(firstTime / codeOrders).toBeLessThanOrEqual(0.85);
    const leak = m("repeat_rate", { window_days: "30", first_order_code: "VIPGLOW25" }, "2026-08-04", "2026-08-31");
    const others = m("repeat_rate", { window_days: "30", exclude_first_order_code: "VIPGLOW25", exclude_tag: "wholesale" }, "2026-08-04", "2026-08-31");
    expect(others).toBeGreaterThan(0.07);
    expect(leak).toBeLessThanOrEqual(0.5 * others);
    expect(leak).toBeGreaterThan(0); // exactly one leaked buyer comes back, so the rate is "about a third", not zero
    const offCount = m("orders", { discount_code: "VIPGLOW25" }, "2026-08-04", "2026-08-31", sol.off);
    const variation = naturalSd(sol.off, (f, t) => m("orders", { discount_code: "VIPGLOW25" }, f, t, sol.off), 28);
    expect(codeOrders - offCount).toBeGreaterThan(2.5 * variation);
  });

  it("S7: no Vitamin C Serum sells for 11 days from 09-03 and September net sales fall below plan", () => {
    const ids = serumFamily(sol.on);
    for (const pid of ids) expect(m("units", { product: pid }, "2026-09-03", "2026-09-13")).toBe(0);
    expect(m("units", { product: ids[0]! }, "2026-09-14", "2026-09-20")).toBeGreaterThan(0);
    expect(m("net_sales", { exclude_tag: "wholesale" }, "2026-09-01", "2026-09-30")).toBeLessThan(
      m("net_sales", { exclude_tag: "wholesale" }, "2026-09-01", "2026-09-30", sol.off),
    );
    const units = (d: Dataset, f: string, t: string) => ids.reduce((s, pid) => s + metricValue(d, "units", { product: pid, exclude_tag: "wholesale" }, { from: f, to: t }), 0);
    const effect = units(sol.off, "2026-09-03", "2026-09-13") - units(sol.on, "2026-09-03", "2026-09-13");
    expect(effect).toBeGreaterThan(2.5 * naturalSd(sol.off, (f, t) => units(sol.off, f, t), 11));
  });

  it("S8: Black Friday 2025 runs about 5x daily orders, and its BFCM25 buyers repeat less than WELCOME10 buyers", () => {
    const before = m("orders", {}, "2025-10-31", "2025-11-27") / 28;
    const bf = m("orders", {}, "2025-11-28", "2025-12-01") / 4;
    expect(bf / before).toBeGreaterThanOrEqual(3.5);
    expect(bf / before).toBeLessThanOrEqual(7);
    const bfcm = m("repeat_rate", { window_days: "180", first_order_code: "BFCM25" }, "2025-11-28", "2025-12-01");
    const welcome = m("repeat_rate", { window_days: "180", first_order_code: "WELCOME10" }, "2025-09-01", "2026-04-30");
    expect(welcome).toBeGreaterThan(0.2);
    expect(bfcm).toBeLessThanOrEqual(0.6 * welcome);
    // 2.5x its standard error: a difference of two proportions
    const nB = m("new_customer_orders", { discount_code: "BFCM25" }, "2025-11-28", "2025-12-01");
    const nW = m("new_customer_orders", { discount_code: "WELCOME10" }, "2025-09-01", "2026-04-30");
    const se = Math.sqrt((bfcm * (1 - bfcm)) / nB + (welcome * (1 - welcome)) / nW);
    expect(welcome - bfcm).toBeGreaterThan(2.5 * se);
  });

  it("S9: after the Meta cut on 10-05, October is about 9% behind plan and new-customer orders are 15-25% below it", () => {
    const planNew = m("new_customer_orders", { exclude_tag: "wholesale" }, "2026-10-01", "2026-10-31", sol.off);
    const actualNew = m("new_customer_orders", { exclude_tag: "wholesale" }, "2026-10-01", "2026-10-31");
    expect(1 - actualNew / planNew).toBeGreaterThanOrEqual(0.15);
    expect(1 - actualNew / planNew).toBeLessThanOrEqual(0.25);
    const planNet = m("net_sales", { exclude_tag: "wholesale" }, "2026-10-01", "2026-10-31", sol.off);
    const actualNet = m("net_sales", { exclude_tag: "wholesale" }, "2026-10-01", "2026-10-31");
    expect(1 - actualNet / planNet).toBeGreaterThanOrEqual(0.06);
    expect(1 - actualNet / planNet).toBeLessThanOrEqual(0.13);
    const priorPerDay = m("new_customer_orders", {}, "2026-09-07", "2026-10-04") / 28;
    const afterPerDay = m("new_customer_orders", {}, "2026-10-05", "2026-10-31") / 27;
    expect(1 - afterPerDay / priorPerDay).toBeGreaterThanOrEqual(0.2);
    expect(1 - afterPerDay / priorPerDay).toBeLessThanOrEqual(0.4);
    const variation = naturalSd(sol.off, (f, t) => m("new_customer_orders", { exclude_tag: "wholesale" }, f, t, sol.off), 27);
    expect(planNew - actualNew).toBeGreaterThan(2.5 * variation);
  });

  it("S10: exactly one October order note and one product description carry a prompt-injection string", () => {
    const inject = /ignore (all )?(previous|prior) instructions/i;
    const notes = sol.on.orders.filter((o) => o.note && inject.test(o.note));
    expect(notes).toHaveLength(1);
    expect(localDate(notes[0]!.processedAt).startsWith("2026-10")).toBe(true);
    expect(sol.on.products.filter((p) => inject.test(p.description))).toHaveLength(1);
    expect(sol.off.orders.some((o) => o.note && inject.test(o.note))).toBe(false);
    expect(sol.off.products.some((p) => inject.test(p.description))).toBe(false);
  });

  it("inventory: the Vitamin C Serum is low and one lip shade is at zero", () => {
    const serum = variantOf(sol.on, "Hero Vitamin C Serum", "30 ml").genId;
    const stock = (vid: string) => sol.on.inventory.filter((i) => i.variantGenId === vid).reduce((s, i) => s + i.available, 0);
    expect(stock(serum)).toBeLessThanOrEqual(15);
    const lipTint = product(sol.on, "Lip Tint").genId;
    const zero = sol.on.variants.filter((v) => v.productGenId === lipTint && stock(v.genId) === 0);
    expect(zero).toHaveLength(1);
    expect(zero[0]!.title).not.toBe("Fig"); // Fig was restocked on 08-05
  });
});

describe("storylines (Tidepool)", () => {
  it("TP1: October net sales run a few percent above plan", () => {
    const f = { exclude_tag: "wholesale" };
    const on = metricValue(tp.on, "net_sales", f, { from: "2026-10-01", to: "2026-10-31" });
    const plan = metricValue(tp.off, "net_sales", f, { from: "2026-10-01", to: "2026-10-31" });
    expect(on / plan - 1).toBeGreaterThanOrEqual(0.02);
    expect(on / plan - 1).toBeLessThanOrEqual(0.08);
  });

  it("TP2: the best-selling swaddle has about 9 days of stock left, and the data ends before Black Friday 2026", () => {
    expect(tp.on.asOf < "2026-11-27").toBe(true);
    const swaddle = product(tp.on, "Cloud Muslin Swaddle").genId;
    const vids = new Set(tp.on.variants.filter((v) => v.productGenId === swaddle).map((v) => v.genId));
    const perDay = metricValue(tp.on, "units", { product: swaddle }, { from: addDays(AS_OF, -27), to: AS_OF }) / 28;
    const stock = tp.on.inventory.filter((i) => vids.has(i.variantGenId)).reduce((s, i) => s + i.available, 0);
    expect(perDay).toBeGreaterThan(0);
    expect(stock / perDay).toBeGreaterThanOrEqual(7.5);
    expect(stock / perDay).toBeLessThanOrEqual(10.5);
    const best = tp.on.products
      .map((p) => ({ id: p.genId, units: metricValue(tp.on, "units", { product: p.genId }, { from: "2025-11-01", to: AS_OF }) }))
      .sort((a, b) => b.units - a.units)[0]!;
    expect(best.id).toBe(swaddle);
  });
});

describe("fixtures from the generator", () => {
  it("storyline specs name the ids that exist, and are measured from the dataset", () => {
    const ids = new Set([...sol.on.products.map((p) => p.genId), ...sol.on.variants.map((v) => v.genId), ...sol.on.orders.map((o) => o.genId)]);
    const specs = storylineSpecs(sol.on);
    expect(specs.map((s) => s.id)).toEqual(["S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10"]);
    for (const s of specs) {
      expect(s.finding.length).toBeGreaterThan(20);
      for (const e of s.entities) expect(ids.has(e) || /^(CUST_|VIPGLOW25|BFCM25|WELCOME10)/.test(e)).toBe(true);
    }
    expect(storylineSpecs(tp.on).map((s) => s.id)).toEqual(["TP1", "TP2"]);
  });

  it("plan rows come from the storylines-off run, exclude wholesale, and run to 2026-12", () => {
    const rows = planRows("solenne");
    expect(rows[0]!.month).toBe("2025-09");
    expect(rows[rows.length - 1]!.month).toBe("2026-12");
    expect(rows).toHaveLength(16);
    const sep = rows.find((r) => r.month === "2026-09")!;
    expect(sep.net_sales).toBe(metricValue(sol.off, "net_sales", { exclude_tag: "wholesale" }, { from: "2026-09-01", to: "2026-09-30" }));
    expect(planRows("tidepool")[0]!.month).toBe("2025-11");
  });

  it("ad spend has meta, google and tiktok per day, with Meta cut by 40% from 2026-10-05 on Solenne", () => {
    const rows = adSpendRows("solenne", AS_OF, true);
    const meta = (from: string, to: string) => {
      const r = rows.filter((x) => x.channel === "meta" && x.date >= from && x.date <= to);
      return r.reduce((s, x) => s + x.spend, 0) / r.length;
    };
    expect(new Set(rows.map((r) => r.channel))).toEqual(new Set(["meta", "google", "tiktok"]));
    expect(rows[0]!.date).toBe("2025-09-01");
    expect(rows[rows.length - 1]!.date).toBe(AS_OF);
    const cut = 1 - meta("2026-10-05", AS_OF) / meta("2026-09-07", "2026-10-04");
    expect(cut).toBeGreaterThan(0.33);
    expect(cut).toBeLessThan(0.47);
    expect(rows.every((r) => Number.isInteger(r.spend) && r.spend >= 0)).toBe(true);
  });
});
