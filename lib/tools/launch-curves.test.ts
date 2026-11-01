import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setTestNow } from "../clock";
import type { Db } from "../db/client";
import { createTestDb } from "../db/test-db";
import { orderLines, orders, products, tenants } from "../db/schema";
import { seedTwoStores, shopifyId } from "../../scripts/fixtures/load-db";
import type { Dataset } from "../../scripts/seed/types.js";
import type { TenantContext } from "../tenancy/context";
import { ledgerFromToolResults } from "../agent/checker";
import { addDays } from "../metrics/dates";
import { benchmarkOf, compareWithBenchmark, launchCurve, median, splitFirstSales, weeksOf } from "../metrics/launch";
import { getLaunchCurves, type LaunchCurvesData } from "./launch-curves";

const day = (from: string, n: number) => addDays(from, n);
const perDay = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("median", () => {
  it("is the middle value, or the mean of the two middle ones", () => {
    expect(median([5])).toBe(5);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([3, 10, 5, 7])).toBe(6);
    expect(median([4, 5])).toBe(4.5);
  });
});

describe("weeksOf, by hand", () => {
  // Launch on a Wednesday, 2026-01-14. Week 1 is 01-14 to 01-20, week 2 01-21 to 01-27, week 3 01-28 to 02-03.
  const sales = perDay({ "2026-01-14": 3, "2026-01-20": 2, "2026-01-21": 4, "2026-01-27": 1, "2026-01-28": 6, "2026-01-13": 99 });

  it("starts week 1 on the launch day, takes seven days to a week, and counts units from the launch day on", () => {
    const w = weeksOf("2026-01-14", sales, 3, "2026-03-01");
    expect(w).toEqual([
      { week: 1, from: "2026-01-14", to: "2026-01-20", daysObserved: 7, units: 5, cumulativeUnits: 5 },
      { week: 2, from: "2026-01-21", to: "2026-01-27", daysObserved: 7, units: 5, cumulativeUnits: 10 },
      { week: 3, from: "2026-01-28", to: "2026-02-03", daysObserved: 7, units: 6, cumulativeUnits: 16 },
    ]);
  });

  it("cuts the week the data ends in, and leaves out weeks that start after the data ends", () => {
    const w = weeksOf("2026-01-14", sales, 8, "2026-01-30");
    expect(w).toHaveLength(3);
    expect(w[2]).toEqual({ week: 3, from: "2026-01-28", to: "2026-01-30", daysObserved: 3, units: 6, cumulativeUnits: 16 });
  });

  it("a launch on the last day of the data has one day of week 1", () => {
    expect(weeksOf("2026-03-01", perDay({ "2026-03-01": 2 }), 4, "2026-03-01")).toEqual([{ week: 1, from: "2026-03-01", to: "2026-03-01", daysObserved: 1, units: 2, cumulativeUnits: 2 }]);
  });
});

describe("launchCurve, benchmarkOf and compareWithBenchmark, by hand", () => {
  const last = "2026-02-10";
  // Three launches with two full weeks each (units 5,4 / 10,6 / 7,0) and one that has only 3 days of week 2.
  const curves = [
    launchCurve("a", "2026-01-01", perDay({ "2026-01-02": 5, "2026-01-09": 4 }), 2, last),
    launchCurve("b", "2026-01-05", perDay({ "2026-01-05": 10, "2026-01-12": 6 }), 2, last),
    launchCurve("c", "2026-01-20", perDay({ "2026-01-20": 7 }), 2, last),
    launchCurve("d", "2026-02-01", perDay({ "2026-02-01": 3, "2026-02-09": 1 }), 2, last),
  ];

  it("sums the observed weeks and says whether all the asked weeks were seen", () => {
    expect(curves[0]).toMatchObject({ productId: "a", launchDate: "2026-01-01", daysObserved: 14, fullyObserved: true, totalUnits: 9 });
    expect(curves[3]).toMatchObject({ productId: "d", launchDate: "2026-02-01", daysObserved: 10, fullyObserved: false, totalUnits: 4 });
    expect(curves[3]!.weeks.map((w) => w.daysObserved)).toEqual([7, 3]);
  });

  it("caps the days observed at the weeks asked for", () => {
    expect(launchCurve("a", "2025-06-01", perDay({}), 4, last)).toMatchObject({ daysObserved: 28, fullyObserved: true, totalUnits: 0 });
  });

  it("takes the median over the launches whose week is fully observed", () => {
    expect(benchmarkOf(curves)).toEqual([
      { week: 1, medianUnits: 6, medianCumulativeUnits: 6, launches: 4 }, // 3, 5, 7, 10
      { week: 2, medianUnits: 4, medianCumulativeUnits: 9, launches: 3 }, // d's week 2 has 3 days: left out; 4, 6, 0 and 9, 16, 7
    ]);
  });

  it("leaves out a week no launch has fully seen", () => {
    expect(benchmarkOf([curves[3]!])).toEqual([{ week: 1, medianUnits: 3, medianCumulativeUnits: 3, launches: 1 }]);
    expect(benchmarkOf([])).toEqual([]);
  });

  it("works out each week against the median as fields, and gives nothing for a partial week or a median of 0", () => {
    const bench = benchmarkOf(curves);
    const a = compareWithBenchmark(curves[0]!, bench);
    expect(a[0]).toMatchObject({ week: 1, units: 5, vsMedianUnits: -1, pctOfMedianUnits: 5 / 6 });
    expect(a[1]).toMatchObject({ week: 2, units: 4, vsMedianUnits: 0, pctOfMedianUnits: 1 });
    const c = compareWithBenchmark(curves[2]!, bench);
    expect(c[1]).toMatchObject({ units: 0, vsMedianUnits: -4, pctOfMedianUnits: 0 });
    const d = compareWithBenchmark(curves[3]!, bench);
    expect(d[0]).toMatchObject({ units: 3, vsMedianUnits: -3, pctOfMedianUnits: 0.5 });
    expect(d[1]).toMatchObject({ daysObserved: 3, units: 1, vsMedianUnits: null, pctOfMedianUnits: null });
    expect(compareWithBenchmark(curves[0]!, [{ week: 1, medianUnits: 0, medianCumulativeUnits: 0, launches: 2 }, { week: 2, medianUnits: 0, medianCumulativeUnits: 0, launches: 2 }])[0]).toMatchObject({ vsMedianUnits: 5, pctOfMedianUnits: null });
  });
});

describe("splitFirstSales, by hand", () => {
  it("a launch needs its first sale at least 14 days after the first order in the data", () => {
    const first = new Map([["a", "2026-01-01"], ["b", "2026-01-14"], ["c", "2026-01-15"], ["d", "2026-03-01"]]);
    const r = splitFirstSales(first, "2026-01-01");
    expect(r.launches).toEqual([{ productId: "c", launchDate: "2026-01-15" }, { productId: "d", launchDate: "2026-03-01" }]);
    expect(r.alreadySelling.sort()).toEqual(["a", "b"]);
  });
});

// ---- A small store built by hand, so the edges can be set exactly (the fixtures' launches are fixed).

const LAST = "2026-04-30"; // the last day of the data; the anchor product sells every day from 2026-01-01 to here
const TZ = "America/New_York";

async function buildStore(db: Db, name: string, sales: { product: string; date: string; qty: number; cancelled?: boolean; noProduct?: boolean }[], titles: Record<string, string>): Promise<TenantContext> {
  const [t] = await db.insert(tenants).values({ orgId: `org_${name}`, name }).returning({ id: tenants.id });
  const tenantId = t!.id;
  await db.insert(products).values(Object.entries(titles).map(([id, title]) => ({ tenantId, id, title, handle: id.toLowerCase(), status: "ACTIVE" })));
  const at = (date: string) => new Date(`${date}T17:00:00Z`);
  await db.insert(orders).values(sales.map((s, i) => ({ tenantId, id: `O${i}`, name: `#${1000 + i}`, processedAt: at(s.date), localDate: s.date, grossCents: 1000 * s.qty, discountCents: 0, shippingCents: 0, channel: "online", ...(s.cancelled ? { cancelledAt: at(s.date) } : {}) })));
  await db.insert(orderLines).values(sales.map((s, i) => ({ tenantId, id: `L${i}`, orderId: `O${i}`, productId: s.noProduct ? null : s.product, quantity: s.qty, unitPriceCents: 1000, discountCents: 0 })));
  return { tenantId, orgId: `org_${name}`, userId: "u1", role: "gc_admin", shop: { domain: `${name}.myshopify.com`, timezone: TZ, currency: "USD", status: "connected" } };
}

const anchorSales = () => {
  const out = [];
  for (let d = "2026-01-01"; d <= LAST; d = addDays(d, 1)) out.push({ product: "A", date: d, qty: 1 });
  return out;
};

describe("a small store, built by hand", () => {
  let db: Db;
  let ctx: TenantContext;
  let bare: TenantContext; // a store where every product was already selling

  beforeAll(async () => {
    setTestNow("2026-11-02T12:00:00-05:00");
    db = await createTestDb();
    ctx = await buildStore(
      db,
      "hand",
      [
        ...anchorSales(), // A: already selling when the data starts
        { product: "B", date: "2026-01-14", qty: 2 }, // 13 days after the first order: not a launch
        { product: "C", date: "2026-01-10", qty: 50, cancelled: true }, // a cancelled sale is not a sale: C's launch is the next one
        { product: "C", date: "2026-01-15", qty: 3 }, // 14 days after the first order: a launch
        { product: "C", date: "2026-01-17", qty: 2 },
        { product: "C", date: "2026-01-23", qty: 4 }, // day 8: week 2
        { product: "C", date: "2026-01-29", qty: 9 }, // week 3
        { product: "E", date: "2026-02-10", qty: 10 },
        { product: "E", date: "2026-02-18", qty: 6 },
        { product: "G", date: "2026-03-01", qty: 7 }, // then nothing for two weeks
        { product: "I", date: "2026-04-22", qty: 3 }, // week 1 is fully in the data, week 2 has two days
        { product: "I", date: "2026-04-30", qty: 8 },
        { product: "H", date: "2026-04-27", qty: 2 }, // four days of week 1
        { product: "Z", date: "2026-02-20", qty: 4, cancelled: true }, // only ever cancelled: no sale, no launch
        { product: "X", date: "2026-02-22", qty: 5, noProduct: true }, // a line with no product (a custom item) is not a product's sale
      ],
      { A: "Anchor Cleanser", B: "Barely Late Balm", C: "Cedar Candle", E: "Elm Essence", G: "Ghost Gel", H: "Hazel Hand Cream", I: "Iris Infusion", Z: "Zero Zest" },
    );
    bare = await buildStore(db, "bare", anchorSales(), { A: "Anchor Cleanser" });
  }, 120_000);

  afterAll(() => setTestNow(null));

  const run = (input: Record<string, unknown>, c: TenantContext = ctx) => getLaunchCurves(c, input as never, { db });
  const byId = (d: LaunchCurvesData, id: string) => d.launches.find((l) => l.productId === id)!;

  it("finds the launches: the first non-cancelled sale at least 14 days after the first order, newest first", async () => {
    const res = await run({ weeks: 2 });
    expect(res.data.launches.map((l) => [l.productId, l.launchDate])).toEqual([
      ["H", "2026-04-27"],
      ["I", "2026-04-22"],
      ["G", "2026-03-01"],
      ["E", "2026-02-10"],
      ["C", "2026-01-15"],
    ]);
    expect(res.range).toEqual({ from: "2026-01-15", to: LAST });
    expect(res.queryId).toMatch(/^q_[0-9a-f]{12}$/);
  });

  it("counts units by week from the launch day, before refunds, leaving out cancelled orders", async () => {
    const c = byId((await run({ weeks: 3 })).data, "C");
    expect(c.weeks.map((w) => [w.from, w.to, w.units, w.cumulativeUnits])).toEqual([
      ["2026-01-15", "2026-01-21", 5, 5],
      ["2026-01-22", "2026-01-28", 4, 9],
      ["2026-01-29", "2026-02-04", 9, 18],
    ]);
    expect(c).toMatchObject({ daysObserved: 21, fullyObserved: true, totalUnits: 18, untrusted: { product: "Cedar Candle" } });
  });

  it("benchmarks each week on the launches that fully saw it, and works the comparison out as fields", async () => {
    const d = (await run({ weeks: 2 })).data;
    // Week 1: C 5, E 10, G 7, I 3, H not fully observed. Week 2: C 4, E 6, G 0; I has two days of it.
    expect(d.benchmark).toEqual([
      { week: 1, medianUnits: 6, medianCumulativeUnits: 6, launches: 4 },
      { week: 2, medianUnits: 4, medianCumulativeUnits: 9, launches: 3 },
    ]);
    expect(byId(d, "C").weeks).toEqual([
      { week: 1, from: "2026-01-15", to: "2026-01-21", daysObserved: 7, units: 5, cumulativeUnits: 5, vsMedianUnits: -1, pctOfMedianUnits: 5 / 6 },
      { week: 2, from: "2026-01-22", to: "2026-01-28", daysObserved: 7, units: 4, cumulativeUnits: 9, vsMedianUnits: 0, pctOfMedianUnits: 1 },
    ]);
    expect(byId(d, "G").weeks[1]).toMatchObject({ units: 0, vsMedianUnits: -4, pctOfMedianUnits: 0 });
    expect(byId(d, "E").weeks[0]).toMatchObject({ units: 10, vsMedianUnits: 4, pctOfMedianUnits: 10 / 6 });
  });

  it("a partly observed week keeps its units but has no comparison, and the launch says it is not fully observed", async () => {
    const d = (await run({ weeks: 2 })).data;
    const i = byId(d, "I");
    expect(i).toMatchObject({ daysObserved: 9, fullyObserved: false, totalUnits: 11 });
    expect(i.weeks[0]).toMatchObject({ daysObserved: 7, units: 3, vsMedianUnits: -3, pctOfMedianUnits: 0.5 });
    expect(i.weeks[1]).toEqual({ week: 2, from: "2026-04-29", to: "2026-04-30", daysObserved: 2, units: 8, cumulativeUnits: 11, vsMedianUnits: null, pctOfMedianUnits: null });
    const h = byId(d, "H");
    expect(h).toMatchObject({ daysObserved: 4, fullyObserved: false, totalUnits: 2 });
    expect(h.weeks).toHaveLength(1);
    expect(h.weeks[0]).toMatchObject({ from: "2026-04-27", to: "2026-04-30", daysObserved: 4, units: 2, vsMedianUnits: null, pctOfMedianUnits: null });
  });

  it("the default is 8 weeks, and a launch that has not had 8 weeks says so", async () => {
    const d = (await run({})).data;
    expect(byId(d, "C")).toMatchObject({ daysObserved: 56, fullyObserved: true });
    expect(byId(d, "C").weeks).toHaveLength(8);
    expect(byId(d, "G")).toMatchObject({ daysObserved: 56, fullyObserved: true }); // 2026-03-01 + 55 days is 04-25
    expect(byId(d, "E")).toMatchObject({ daysObserved: 56, fullyObserved: true });
    expect(byId(d, "I").fullyObserved).toBe(false);
    expect(d.benchmark.map((b) => b.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(d.benchmark[7]!.launches).toBe(3);
  });

  it("states the definitions it needs and the products left out for already selling", async () => {
    const res = await run({ weeks: 2 });
    expect(Object.keys(res.definitions)).toEqual(expect.arrayContaining(["launch", "week", "units", "benchmark", "comparison"]));
    expect(res.definitions.launch).toMatch(/first sale/);
    expect(res.definitions.launch).toMatch(/14 days/);
    expect(res.definitions.units).toMatch(/before refunds/);
    expect(res.definitions.units).toMatch(/cancelled/);
    expect(res.data.caveats!.join(" ")).toMatch(/2 products were left out .* already selling/);
    expect(res.asOf).toEqual(expect.any(String));
  });

  it("launch dates inside a range keep to it, and the benchmark is that group", async () => {
    const res = await run({ weeks: 2, launchedFrom: "2026-02-01", launchedTo: "2026-03-31" });
    expect(res.data.launches.map((l) => l.productId)).toEqual(["G", "E"]);
    expect(res.data.benchmark[0]).toEqual({ week: 1, medianUnits: 8.5, medianCumulativeUnits: 8.5, launches: 2 });
    expect(res.range).toEqual({ from: "2026-02-10", to: LAST });
    expect((res.data.caveats ?? []).join(" ")).not.toMatch(/already selling/); // A and B launched before the range
  });

  it("productIds picks the launches to list, but each is compared with every launch in the range", async () => {
    const res = await run({ weeks: 2, productIds: ["C", "A", "B", "no-such-product"] });
    expect(res.data.launches.map((l) => l.productId)).toEqual(["C"]);
    expect(res.data.launches[0]!.weeks[0]).toMatchObject({ vsMedianUnits: -1, pctOfMedianUnits: 5 / 6 }); // against the median of all four, not of C alone
    expect(res.data.benchmark[0]!.launches).toBe(4);
    const text = res.data.caveats!.join(" ");
    expect(text).toMatch(/2 products were left out .* already selling/); // A and B were asked for
    expect(text).toMatch(/1 of the 4 products asked for/);
  });

  it("limits the launches listed and says how many there are", async () => {
    const res = await run({ weeks: 2, limit: 2 });
    expect(res.data.launches.map((l) => l.productId)).toEqual(["H", "I"]);
    expect(res.truncated).toEqual({ shown: 2, total: 5 });
    expect(res.data.benchmark[0]!.launches).toBe(4); // the benchmark still uses every launch
  });

  it("a launch range inside the data but before any launch is an empty answer with a caveat, not an error", async () => {
    const d = (await run({ launchedFrom: "2026-01-01", launchedTo: "2026-01-10" })).data;
    expect(d.launches).toEqual([]);
    expect(d.benchmark).toEqual([]);
    expect(d.caveats!.join(" ")).toMatch(/No product launched/);
    expect(d.caveats!.join(" ")).toMatch(/1 product was left out .* already selling/);
  });

  it("a store whose products were all selling from the start has no launches, as a caveat and not an error", async () => {
    const res = await run({}, bare);
    expect(res.data.launches).toEqual([]);
    expect(res.data.benchmark).toEqual([]);
    expect(res.data.caveats!.join(" ")).toMatch(/No product launched/);
    expect(res.range).toEqual({ from: "2026-01-01", to: LAST });
    expect(res.truncated).toBeUndefined();
  });

  it("answers NO_DATA for a launch range outside the data", async () => {
    await expect(run({ launchedFrom: "2024-01-01", launchedTo: "2024-06-30" })).rejects.toMatchObject({ code: "NO_DATA" });
    await expect(run({ launchedFrom: "2027-01-01", launchedTo: "2027-06-30" })).rejects.toMatchObject({ code: "NO_DATA" });
  });

  it("the checker reads pctOfMedianUnits as a percentage and the units as counts", async () => {
    const res = await run({ weeks: 2 });
    const entries = ledgerFromToolResults([res]).entries;
    const c = res.data.launches.findIndex((l) => l.productId === "C");
    expect(entries.find((e) => e.path === `data.launches[${c}].weeks[0].pctOfMedianUnits`)).toMatchObject({ unit: "rate", value: (5 / 6) * 100 });
    expect(entries.find((e) => e.path === `data.launches[${c}].weeks[0].units`)).toMatchObject({ unit: "count", value: 5 });
    expect(entries.find((e) => e.path === "data.benchmark[0].medianUnits")).toMatchObject({ unit: "count", value: 6 });
    expect(entries.every((e) => !e.path.includes("untrusted"))).toBe(true);
  });
});

describe("validation", () => {
  let db: Db;
  let ctx: TenantContext;

  beforeAll(async () => {
    setTestNow("2026-11-02T12:00:00-05:00");
    db = await createTestDb();
    ctx = await buildStore(db, "valid", anchorSales(), { A: "Anchor Cleanser" });
  }, 120_000);

  afterAll(() => setTestNow(null));

  const run = (input: Record<string, unknown>, c: TenantContext = ctx) => getLaunchCurves(c, input as never, { db });

  it("rejects a key it doesn't know", async () => {
    for (const key of ["tenantId", "shopDomain", "orgId", "shop"]) await expect(run({ [key]: "other" }), key).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("needs launchedFrom and launchedTo together, in order, and real dates", async () => {
    await expect(run({ launchedFrom: "2026-02-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ launchedTo: "2026-02-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ launchedFrom: "2026-03-01", launchedTo: "2026-02-01" })).rejects.toMatchObject({ code: "INVALID_INPUT", message: expect.stringMatching(/is after/) });
    await expect(run({ launchedFrom: "02/01/2026", launchedTo: "2026-03-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ launchedFrom: "2026-02-30", launchedTo: "2026-03-01" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("limits weeks to a whole number from 1 to 12, and the limit and the ids to their ranges", async () => {
    for (const weeks of [0, 13, 2.5, "8"]) await expect(run({ weeks }), String(weeks)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const limit of [0, -1, 501, "5"]) await expect(run({ limit }), String(limit)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ productIds: "C" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ productIds: [""] })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(run({ weeks: 12 })).resolves.toBeTruthy();
    await expect(run({ weeks: 1 })).resolves.toBeTruthy();
  });

  it("refuses a store that isn't connected", async () => {
    await expect(run({}, { ...ctx, shop: { ...ctx.shop!, status: "disconnected" } })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
    await expect(run({}, { ...ctx, shop: null })).rejects.toMatchObject({ code: "STORE_DISCONNECTED" });
  });

  it("a store with no orders at all is NO_DATA", async () => {
    const [t] = await db.insert(tenants).values({ orgId: "org_empty", name: "empty" }).returning({ id: tenants.id });
    await expect(run({}, { ...ctx, tenantId: t!.id })).rejects.toMatchObject({ code: "NO_DATA" });
  });
});

// ---- The Solenne and Tidepool fixtures: launches expected from the dataset's own orders, worked out here independently.

interface Expected {
  productId: string;
  title: string;
  launchDate: string;
  weeks: { units: number; days: number }[]; // up to 8
}

function expectedLaunches(ds: Dataset, weeks: number): { first: string; last: string; launches: Expected[]; alreadySelling: string[] } {
  const productOf = new Map(ds.variants.map((v) => [v.genId, v.productGenId]));
  const titleOf = new Map(ds.products.map((p) => [p.genId, p.title]));
  const sold = new Map<string, Map<string, number>>();
  const dates: string[] = [];
  for (const o of ds.orders) {
    const date = o.processedAt.slice(0, 10); // processedAt carries the store's offset, so this is the store-local date
    dates.push(date);
    for (const l of o.lines) {
      const p = productOf.get(l.variantGenId)!;
      const m = sold.get(p) ?? new Map<string, number>();
      m.set(date, (m.get(date) ?? 0) + l.qty);
      sold.set(p, m);
    }
  }
  dates.sort();
  const first = dates[0]!;
  const last = dates.at(-1)!;
  const launches: Expected[] = [];
  const alreadySelling: string[] = [];
  for (const [p, m] of sold) {
    const launchDate = [...m.keys()].sort()[0]!;
    if (Date.parse(launchDate) - Date.parse(first) < 14 * 86_400_000) {
      alreadySelling.push(shopifyId.product(p));
      continue;
    }
    const w: Expected["weeks"] = [];
    for (let k = 0; k < weeks; k++) {
      const start = day(launchDate, 7 * k);
      if (start > last) break;
      let units = 0;
      let days = 0;
      for (let i = 0; i < 7 && day(start, i) <= last; i++) {
        units += m.get(day(start, i)) ?? 0;
        days++;
      }
      w.push({ units, days });
    }
    launches.push({ productId: shopifyId.product(p), title: titleOf.get(p)!, launchDate, weeks: w });
  }
  launches.sort((a, b) => (a.launchDate < b.launchDate ? 1 : a.launchDate > b.launchDate ? -1 : a.productId.localeCompare(b.productId)));
  return { first, last, launches, alreadySelling };
}

const midOf = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

describe("the Solenne and Tidepool fixtures", () => {
  let db: Db;
  let ds: Dataset;
  let tp: Dataset;
  let ctx: TenantContext;
  let tCtx: TenantContext;

  beforeAll(async () => {
    setTestNow("2026-11-02T12:00:00-05:00");
    db = await createTestDb();
    const seeded = await seedTwoStores(db);
    ds = seeded.fixtures.solenne.dataset;
    tp = seeded.fixtures.tidepool.dataset;
    ctx = seeded.ctxs.solenne;
    tCtx = seeded.ctxs.tidepool;
  }, 240_000);

  afterAll(() => setTestNow(null));

  const run = (input: Record<string, unknown>, c: TenantContext = ctx) => getLaunchCurves(c, input as never, { db });

  it("has real launches: products whose first sale comes 14 or more days after the store's first order", () => {
    expect(expectedLaunches(ds, 8).launches.length).toBeGreaterThanOrEqual(8);
    expect(expectedLaunches(tp, 8).launches.length).toBeGreaterThanOrEqual(5);
  });

  it.each([["Solenne"], ["Tidepool"]])("%s: each launch's date and weekly units are the dataset's own", async (store) => {
    const d = store === "Solenne" ? ds : tp;
    const c = store === "Solenne" ? ctx : tCtx;
    const exp = expectedLaunches(d, 8);
    const res = await run({ limit: 200 }, c);
    expect(res.range).toEqual({ from: exp.launches.at(-1)!.launchDate, to: exp.last });
    expect(res.data.launches.map((l) => [l.productId, l.launchDate])).toEqual(exp.launches.map((l) => [l.productId, l.launchDate]));
    for (const e of exp.launches) {
      const got = res.data.launches.find((l) => l.productId === e.productId)!;
      expect(got.untrusted.product, e.title).toBe(e.title);
      expect(got.weeks.map((w) => [w.units, w.daysObserved]), e.title).toEqual(e.weeks.map((w) => [w.units, w.days]));
      expect(got.totalUnits).toBe(e.weeks.reduce((s, w) => s + w.units, 0));
      expect(got.daysObserved).toBe(Math.min(56, e.weeks.reduce((s, w) => s + w.days, 0)));
      expect(got.fullyObserved).toBe(e.weeks.length === 8 && e.weeks.every((w) => w.days === 7));
    }
    const left = exp.alreadySelling.length;
    expect(res.data.caveats!.join(" ")).toContain(`${left} ${left === 1 ? "product was" : "products were"} left out`);
  });

  it("Solenne: the benchmark is the median of the launches whose week is fully observed, and every comparison follows from it", async () => {
    const exp = expectedLaunches(ds, 8);
    const res = await run({ limit: 200 });
    for (const b of res.data.benchmark) {
      const full = exp.launches.map((l) => ({ units: l.weeks.slice(0, b.week).map((w) => w.units), complete: l.weeks.length >= b.week && l.weeks[b.week - 1]!.days === 7 })).filter((l) => l.complete);
      expect(b.launches, `week ${b.week}`).toBe(full.length);
      expect(b.medianUnits, `week ${b.week}`).toBe(midOf(full.map((l) => l.units[b.week - 1]!)));
      expect(b.medianCumulativeUnits, `week ${b.week}`).toBe(midOf(full.map((l) => l.units.reduce((s, u) => s + u, 0))));
    }
    for (const l of res.data.launches) {
      for (const w of l.weeks) {
        const b = res.data.benchmark.find((x) => x.week === w.week);
        if (w.daysObserved < 7) {
          expect(w.vsMedianUnits).toBeNull();
          expect(w.pctOfMedianUnits).toBeNull();
        } else {
          expect(w.vsMedianUnits).toBe(w.units - b!.medianUnits);
          expect(w.pctOfMedianUnits).toBe(b!.medianUnits === 0 ? null : w.units / b!.medianUnits);
        }
      }
    }
  });

  it("Solenne: the launches the eval cases can use are in the data", async () => {
    const res = await run({ weeks: 4 });
    const titles = res.data.launches.map((l) => l.untrusted.product);
    expect(titles).toEqual(expect.arrayContaining(["Neck Cream", "Gua Sha Stone", "Daily Gel Cleanser Mini", "Niacinamide Clarity Serum"]));
    const neck = res.data.launches.find((l) => l.untrusted.product === "Neck Cream")!;
    expect(neck.launchDate).toBe("2025-11-16");
  });

  it("Tidepool: the launches the eval cases can use are in the data, all with their eight weeks seen", async () => {
    const res = await run({}, tCtx);
    const launch = (title: string) => res.data.launches.find((l) => l.untrusted.product === title)!;
    expect(launch("Nursing Pillow Cover").launchDate).toBe("2026-06-27");
    expect(launch("Stroller Blanket").launchDate).toBe("2026-04-16");
    expect(res.range.to).toBe("2026-10-26");
    expect(res.data.launches.every((l) => l.fullyObserved && l.daysObserved === 56)).toBe(true); // the data runs months past the last launch
  });

  it("productIds lists one launch but compares it with the rest", async () => {
    const exp = expectedLaunches(ds, 8).launches.find((l) => l.title === "Neck Cream")!;
    const all = await run({ limit: 200 });
    const one = await run({ productIds: [exp.productId] });
    expect(one.data.launches).toHaveLength(1);
    expect(one.data.launches[0]).toEqual(all.data.launches.find((l) => l.productId === exp.productId));
    expect(one.data.benchmark).toEqual(all.data.benchmark);
  });

  it("launch dates in a range keep to it", async () => {
    const res = await run({ launchedFrom: "2025-10-01", launchedTo: "2025-10-31", limit: 200 });
    const exp = expectedLaunches(ds, 8).launches.filter((l) => l.launchDate >= "2025-10-01" && l.launchDate <= "2025-10-31");
    expect(exp.length).toBeGreaterThan(0);
    expect(res.data.launches.map((l) => l.productId)).toEqual(exp.map((l) => l.productId));
  });
});

describe("tenant isolation", () => {
  let db: Db;
  let ds: Dataset;
  let tp: Dataset;
  let ctx: TenantContext;
  let tCtx: TenantContext;

  beforeAll(async () => {
    setTestNow("2026-11-02T12:00:00-05:00");
    db = await createTestDb();
    const seeded = await seedTwoStores(db);
    ds = seeded.fixtures.solenne.dataset;
    tp = seeded.fixtures.tidepool.dataset;
    ctx = seeded.ctxs.solenne;
    tCtx = seeded.ctxs.tidepool;
  }, 240_000);

  afterAll(() => setTestNow(null));

  const run = (input: Record<string, unknown>, c: TenantContext) => getLaunchCurves(c, input as never, { db });

  it("Tidepool never sees a Solenne product: handed Solenne-only ids it lists nothing", async () => {
    const onlySolenne = ds.products.filter((p) => Number(p.genId.slice(2)) > tp.products.length).map((p) => shopifyId.product(p.genId));
    expect(onlySolenne.length).toBeGreaterThan(0);
    const res = await run({ productIds: onlySolenne }, tCtx);
    expect(res.data.launches).toEqual([]);
    const all = await run({}, tCtx);
    expect(all.data.launches.every((l) => !onlySolenne.includes(l.productId))).toBe(true);
    expect(all.data.launches.every((l) => tp.products.some((p) => shopifyId.product(p.genId) === l.productId))).toBe(true);
  });

  it("an id both stores use is read from the caller's own orders and catalogue", async () => {
    const shared = shopifyId.product("P_003"); // Niacinamide Clarity Serum in Solenne, Knit Beanie Set in Tidepool; both are launches
    const s = (await run({ productIds: [shared] }, ctx)).data.launches[0]!;
    const t = (await run({ productIds: [shared] }, tCtx)).data.launches[0]!;
    expect(s.untrusted.product).toBe("Niacinamide Clarity Serum");
    expect(t.untrusted.product).toBe("Knit Beanie Set");
    expect(s.launchDate).toBe("2025-10-18");
    expect(t.launchDate).toBe("2026-01-07");
    expect(s.totalUnits).not.toBe(t.totalUnits);
  });
});
