import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CostAssumptions, CostSheetRow, EbitdaData, EbitdaMonth } from "@/lib/ebitda/types";
import { AppError } from "@/lib/errors";
import type { TenantContext } from "@/lib/tenancy/context";
import EbitdaPage from "./page";

// The session, the database handle, the EBITDA tool and the cost-sheet reads are mocked; the real page and components render. This checks the
// page's states (signed out, store disconnected, error, no months, data), what each role sees, which month is drawn, what the what-if
// starts from, and that a month with costs missing says so. The figures themselves are tested with the tool (lib/tools/ebitda.test.ts).
const m = vi.hoisted(() => ({
  ctx: vi.fn<() => Promise<TenantContext>>(),
  get: vi.fn(),
  sheet: vi.fn(),
  rates: vi.fn(),
  table: vi.fn(),
  waterfall: vi.fn(),
  receipts: vi.fn(),
  panel: vi.fn(),
  costSheet: vi.fn(),
}));
vi.mock("@/lib/tenancy/context", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/tenancy/context")>()), getTenantContext: m.ctx }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ fake: "db" }) }));
vi.mock("@/lib/tools/ebitda", () => ({ getEbitda: m.get }));
vi.mock("@/lib/ebitda/store", () => ({ loadCostSheet: m.sheet, loadAssumptions: m.rates }));
// The editable sheet refreshes the page after a save, so it needs the app router. The real components still render, each behind a spy
// that records what the page gave it.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/ebitda", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ebitda/bridge-table", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ebitda/bridge-table")>();
  return {
    ...real,
    BridgeTable: (props: Parameters<typeof real.BridgeTable>[0]) => {
      m.table(props);
      return real.BridgeTable(props);
    },
  };
});
vi.mock("@/components/ebitda/waterfall", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ebitda/waterfall")>();
  return {
    ...real,
    Waterfall: (props: Parameters<typeof real.Waterfall>[0]) => {
      m.waterfall(props);
      return real.Waterfall(props);
    },
  };
});
vi.mock("@/components/ebitda/receipts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ebitda/receipts")>();
  return {
    ...real,
    Receipts: (props: Parameters<typeof real.Receipts>[0]) => {
      m.receipts(props);
      return real.Receipts(props);
    },
  };
});
vi.mock("@/components/ebitda/scenario-panel", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ebitda/scenario-panel")>();
  return {
    ...real,
    ScenarioPanel: (props: Parameters<typeof real.ScenarioPanel>[0]) => {
      m.panel(props);
      return real.ScenarioPanel(props);
    },
  };
});
vi.mock("@/components/ebitda/cost-sheet", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ebitda/cost-sheet")>();
  return {
    ...real,
    CostSheet: (props: Parameters<typeof real.CostSheet>[0]) => {
      m.costSheet(props);
      return real.CostSheet(props);
    },
  };
});

const shop = { domain: "solenne.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" as const };
const session = (over: Partial<TenantContext> = {}): TenantContext => ({ tenantId: "tenant-a", orgId: "org_a", userId: "user_a", role: "gc_partner", shop, ...over });

// A month whose bridge adds up: 600,000 - 200,000 - 20,000 - 30,000 - 100,000 = 250,000, less 40,000 of operating costs = 210,000.
const month = (id: string, over: Partial<EbitdaMonth> = {}): EbitdaMonth => ({
  month: id,
  partial: false,
  netSalesCents: 600_000,
  costOfGoodsCents: 200_000,
  cardFeesCents: 20_000,
  fulfilmentCents: 30_000,
  adSpendCents: 100_000,
  profitAfterVariableCostsCents: 250_000,
  operatingCostsCents: 40_000,
  ebitdaCents: 210_000,
  ebitdaRate: 0.35,
  profitAfterVariableCostsRate: 250_000 / 600_000,
  orders: 100,
  newCustomerOrders: 40,
  operatingCosts: [{ category: "software", amountCents: 40_000 }],
  operatingCostsEntered: true,
  unitsWithoutCost: 0,
  ebitdaIsCeiling: false,
  ...over,
});
// Nothing entered on the cost sheet for the month: no operating costs taken off, so EBITDA is a ceiling.
const noCosts: Partial<EbitdaMonth> = { operatingCosts: [], operatingCostsEntered: false, operatingCostsCents: 0, ebitdaCents: 250_000, ebitdaRate: 250_000 / 600_000, ebitdaIsCeiling: true };
const withCeiling = (months: EbitdaMonth[], id: string, over: Partial<EbitdaMonth>) => months.map((x) => (x.month === id ? { ...x, ...over } : x));

// Five complete months with different net sales, so a sum over the wrong months shows.
const FIVE = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const five = (): EbitdaMonth[] => FIVE.map((id, i) => month(id, { netSalesCents: 600_000 + i * 10_000 }));
const result = (months: EbitdaMonth[]) => {
  const data: EbitdaData = {
    months,
    total: { ...month("total"), orders: months.length * 100, unitsWithoutCost: 0, ebitdaIsCeiling: months.some((x) => x.ebitdaIsCeiling) },
    cardFeeRate: 0.029,
    cardFeeFixedCents: 30,
    fulfilmentCentsPerOrder: 450,
    assumptionsSource: "fixture",
    sources: {
      netSales: "Shopify orders (synced)",
      costOfGoods: "Unit costs in Shopify × units sold",
      cardFees: "Assumed rate: 2.9% + $0.30 per order",
      fulfilment: "Assumed: $4.50 per order",
      adSpend: "Ad spend file (not from Shopify)",
      operatingCosts: "Cost sheet (seeded demo data)",
    },
  };
  return { data, queryId: "q_1", range: { from: "2026-06-01", to: "2026-10-31" }, definitions: {}, asOf: "2026-11-01T00:00:00.000Z" };
};

const assumptions: CostAssumptions = { cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 };
const rows: CostSheetRow[] = FIVE.map((id) => ({ month: id, category: "software", amountCents: 40_000, source: "fixture" }));

type Query = Record<string, string | string[] | undefined>;
const render = async (query: Query = {}) => renderToStaticMarkup(await EbitdaPage({ searchParams: Promise.resolve(query as { month?: string | string[] }) }));
const waterfallMonth = () => (m.waterfall.mock.calls[0]![0] as { month: EbitdaMonth }).month.month;
const selectedInTable = () => (m.table.mock.calls[0]![0] as { selected: string }).selected;

beforeEach(() => {
  vi.clearAllMocks();
  m.ctx.mockResolvedValue(session());
  m.get.mockResolvedValue(result(five()));
  m.sheet.mockResolvedValue(rows);
  m.rates.mockResolvedValue({ assumptions, source: "fixture" });
});

describe("the EBITDA page: states", () => {
  it("shows a forbidden banner with no session, and reads nothing", async () => {
    m.ctx.mockRejectedValue(new Error("no session"));
    const out = await render();
    expect(out).toContain('role="alert"');
    expect(m.get).not.toHaveBeenCalled();
    expect(m.sheet).not.toHaveBeenCalled();
  });

  it("a disconnected store, or a brand with no store, shows the STORE_DISCONNECTED banner and reads nothing", async () => {
    for (const shopState of [{ ...shop, status: "disconnected" as const }, null]) {
      m.ctx.mockResolvedValue(session({ shop: shopState }));
      const out = await render();
      expect(out).toContain("The store needs reconnecting");
      expect(out).toContain('role="alert"');
    }
    expect(m.get).not.toHaveBeenCalled();
    expect(m.table).not.toHaveBeenCalled();
    expect(m.costSheet).not.toHaveBeenCalled();
  });

  it("tells a client viewer to ask the admin to reconnect, and an admin where to do it", async () => {
    m.ctx.mockResolvedValue(session({ role: "client_viewer", shop: { ...shop, status: "disconnected" } }));
    expect(await render()).toContain("Ask your GC admin to reconnect the store.");
    m.ctx.mockResolvedValue(session({ role: "gc_admin", shop: { ...shop, status: "disconnected" } }));
    expect(await render()).toContain('href="/connect"');
  });

  it("shows an error banner, without the detail, when the figures cannot be read", async () => {
    m.get.mockRejectedValue(new Error("connection string postgres://secret"));
    const out = await render();
    expect(out).toContain('role="alert"');
    expect(out).toContain("Something went wrong on our side");
    expect(out).not.toContain("postgres://secret");
    expect(m.table).not.toHaveBeenCalled();
  });

  it("shows the typed problem when the tool refuses, such as a store with no orders yet", async () => {
    m.get.mockRejectedValue(new AppError("NO_DATA", "This store has no synced orders yet."));
    const out = await render();
    expect(out).toContain("No data for that period");
    expect(m.table).not.toHaveBeenCalled();
  });

  it("shows an error banner when the cost sheet cannot be read", async () => {
    m.sheet.mockRejectedValue(new Error("db down"));
    const out = await render();
    expect(out).toContain("Something went wrong on our side");
    expect(out).not.toContain("db down");
    expect(m.table).not.toHaveBeenCalled();
  });

  it("says there is nothing to show when the tool returns no months", async () => {
    m.get.mockResolvedValue(result([]));
    const out = await render();
    expect(out).toContain("No months to show yet");
    expect(m.table).not.toHaveBeenCalled();
    expect(m.costSheet).not.toHaveBeenCalled();
  });
});

describe("the EBITDA page: what it lays out", () => {
  it("reads the signed-in brand's figures, sheet and rates, and lays out the bridge, the month, the receipts, the what-if and the sheet in that order", async () => {
    const out = await render({ month: "2026-08", tenantId: "tenant-b" });
    expect(m.get).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }), {}, { db: { fake: "db" } });
    expect(m.sheet).toHaveBeenCalledWith({ fake: "db" }, "tenant-a", { from: "2026-06", to: "2026-10" }); // the months shown; a tenant in the query changes nothing
    expect(m.rates).toHaveBeenCalledWith({ fake: "db" }, "tenant-a");
    const order = ["bridge-heading", "month-heading", "receipts-heading", "scenario-heading", "sheet-heading"].map((id) => out.indexOf(`id="${id}"`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const spy of [m.table, m.waterfall, m.receipts, m.panel, m.costSheet]) expect(spy).toHaveBeenCalledTimes(1);
    expect((m.table.mock.calls[0]![0] as { months: EbitdaMonth[] }).months.map((x) => x.month)).toEqual(FIVE);
    expect((m.receipts.mock.calls[0]![0] as { data: EbitdaData }).data.sources.cardFees).toBe("Assumed rate: 2.9% + $0.30 per order");
  });

  it("a client viewer sees the bridge, the chart and the sheet, not a Growth Capital roles only screen", async () => {
    m.ctx.mockResolvedValue(session({ role: "client_viewer" }));
    const out = await render();
    expect(out).not.toContain("Growth Capital roles only");
    expect(out).toContain("Month by month");
    expect(m.table).toHaveBeenCalledTimes(1);
    expect(m.waterfall).toHaveBeenCalledTimes(1);
    expect(m.costSheet).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["gc_admin", true],
    ["gc_partner", true],
    ["client_viewer", false],
  ] as const)("a %s gets canEdit %s on the cost sheet", async (role, canEdit) => {
    m.ctx.mockResolvedValue(session({ role }));
    await render();
    expect(m.costSheet).toHaveBeenCalledWith({ months: FIVE, rows, assumptions, canEdit, currency: "USD" });
  });
});

describe("the EBITDA page: which month is drawn", () => {
  it("draws the latest complete month by default, not a partial one after it", async () => {
    m.get.mockResolvedValue(result([...five(), month("2026-11", { partial: true })]));
    const out = await render();
    expect(waterfallMonth()).toBe("2026-10");
    expect(selectedInTable()).toBe("2026-10");
    expect((m.waterfall.mock.calls[0]![0] as { month: EbitdaMonth }).month.partial).toBe(false); // November is in the table as month to date, but is not the one drawn
    expect(out).toContain("October 2026 in detail");
  });

  it("?month= picks one of the months on the page", async () => {
    const out = await render({ month: "2026-08" });
    expect(waterfallMonth()).toBe("2026-08");
    expect(selectedInTable()).toBe("2026-08");
    expect(out).toContain("August 2026 in detail");
  });

  it("a partial month can be picked, and is drawn as month to date", async () => {
    m.get.mockResolvedValue(result([...five(), month("2026-11", { partial: true })]));
    const out = await render({ month: "2026-11" });
    expect(waterfallMonth()).toBe("2026-11");
    expect((m.waterfall.mock.calls[0]![0] as { month: EbitdaMonth }).month.partial).toBe(true);
    expect(out).toContain("November 2026 in detail");
  });

  it.each([
    ["a malformed month", "2026-13"],
    ["text", "last-month"],
    ["a full date", "2026-08-01"],
    ["a month with no data", "2024-01"],
    ["a month after the data", "2027-01"],
    ["an empty value", ""],
    ["a repeated value", ["2026-08", "2026-09"]],
  ])("%s falls back to the latest complete month", async (_label, asked) => {
    const out = await render({ month: asked });
    expect(waterfallMonth()).toBe("2026-10");
    expect(selectedInTable()).toBe("2026-10");
    expect(out).toContain("October 2026 in detail");
  });

  it("draws the latest month when none has finished yet", async () => {
    m.get.mockResolvedValue(result([month("2026-10", { partial: true })]));
    await render();
    expect(waterfallMonth()).toBe("2026-10");
  });
});

describe("the EBITDA page: the what-if", () => {
  it("starts from the sum of the last three complete months, and says how many that was", async () => {
    m.get.mockResolvedValue(result([...five(), month("2026-11", { partial: true, netSalesCents: 999_999 })]));
    const out = await render();
    const props = m.panel.mock.calls[0]![0];
    expect(props.months).toBe(3);
    expect(props.assumptions).toEqual(assumptions);
    // August, September and October: 620,000 + 630,000 + 640,000 of net sales. The partial November and the two earliest months are left out.
    expect(props.base).toEqual({ netSalesCents: 1_890_000, orders: 300, newCustomerOrders: 120, costOfGoodsCents: 600_000, adSpendCents: 300_000, operatingCostsCents: 120_000 });
    expect(out).toContain("the last 3 complete months, August 2026 to October 2026");
  });

  it("uses the two complete months there are when there are only two", async () => {
    m.get.mockResolvedValue(result([month("2026-09", { netSalesCents: 100 }), month("2026-10", { netSalesCents: 250 })]));
    const out = await render();
    expect(m.panel.mock.calls[0]![0]).toMatchObject({ months: 2, base: { netSalesCents: 350, orders: 200 } });
    expect(out).toContain("the last 2 complete months, September 2026 to October 2026");
  });

  it("uses the one complete month there is", async () => {
    m.get.mockResolvedValue(result([month("2026-08", { netSalesCents: 777 }), month("2026-09", { partial: true, netSalesCents: 5 })]));
    const out = await render();
    expect(m.panel.mock.calls[0]![0]).toMatchObject({ months: 1, base: { netSalesCents: 777 } });
    expect(out).toContain("the last complete month, August 2026");
  });

  it("has no what-if, and says why, while every month is partial", async () => {
    m.get.mockResolvedValue(result([month("2026-10", { partial: true })]));
    const out = await render();
    expect(m.panel).not.toHaveBeenCalled();
    expect(out).toContain("needs at least one complete month");
    expect(m.costSheet).toHaveBeenCalledTimes(1); // the sheet is still there to fill in
  });

  it("tells the panel its starting EBITDA is a ceiling when one of the months it starts from is", async () => {
    m.get.mockResolvedValue(result(withCeiling(five(), "2026-09", noCosts)));
    const out = await render();
    expect(m.panel.mock.calls[0]![0]).toMatchObject({ baselineIsCeiling: true });
    expect(out).toMatch(/The baseline is a ceiling/);
  });

  it("does not for a ceiling month the what-if does not start from", async () => {
    m.get.mockResolvedValue(result(withCeiling(five(), "2026-06", noCosts))); // June is not one of the last three
    const out = await render();
    expect(m.panel.mock.calls[0]![0]).toMatchObject({ baselineIsCeiling: false });
    expect(out).not.toMatch(/The baseline is a ceiling/);
  });

  it("gives the panel and the other parts the brand's currency", async () => {
    m.ctx.mockResolvedValue(session({ shop: { ...shop, currency: "GBP" } }));
    await render();
    for (const spy of [m.table, m.waterfall, m.receipts, m.panel, m.costSheet]) expect(spy.mock.calls[0]![0]).toMatchObject({ currency: "GBP" });
  });
});

describe("the EBITDA page: a month with costs missing", () => {
  // The notice is the waterfall's: the page hands it the month, and the month says what is missing. The table also marks a ceiling month
  // with a badge and a footnote (which says "some units have no unit cost"), so these look for the sentences that only the notice above
  // the chart has: the heading, the "for this month" sentence about operating costs, and the count of units.
  const NOTICE = /EBITDA is a ceiling for this month/;

  it("a ceiling month shows its notice, and why: no operating costs entered", async () => {
    m.get.mockResolvedValue(result(withCeiling(five(), "2026-10", noCosts)));
    const out = await render();
    expect(out).toMatch(NOTICE);
    expect(out).toMatch(/No operating costs (were )?entered for this month/);
    expect(out).not.toMatch(/\d+ units? (sold )?ha(s|ve) no unit cost/);
    expect((m.waterfall.mock.calls[0]![0] as { month: EbitdaMonth }).month).toMatchObject({ month: "2026-10", ebitdaIsCeiling: true, operatingCostsEntered: false });
  });

  it.each([
    [12, /\b12 units (sold )?have no unit cost/],
    [1, /\b1 unit (sold )?has no unit cost/],
  ])("a ceiling month shows its notice, and why: %s units with no unit cost", async (n, sentence) => {
    m.get.mockResolvedValue(result(withCeiling(five(), "2026-10", { unitsWithoutCost: n, ebitdaIsCeiling: true })));
    const out = await render();
    expect(out).toMatch(NOTICE);
    expect(out).toMatch(sentence);
    expect(out).not.toMatch(/No operating costs (were )?entered for this month/);
  });

  it("gives both reasons when both apply", async () => {
    m.get.mockResolvedValue(result(withCeiling(five(), "2026-10", { ...noCosts, unitsWithoutCost: 3 })));
    const out = await render();
    expect(out).toMatch(/No operating costs (were )?entered for this month/);
    expect(out).toMatch(/\b3 units (sold )?have no unit cost/);
  });

  it("a complete month with every cost in place has no notice, and nothing in the table is marked", async () => {
    const out = await render();
    expect(out).not.toMatch(NOTICE);
    expect(out).not.toContain(">Ceiling<");
    expect(out).not.toMatch(/No operating costs (were )?entered for this month/);
    expect(out).not.toMatch(/\d+ units? (sold )?ha(s|ve) no unit cost/);
  });

  it("the notice is about the month drawn: a ceiling elsewhere in the table does not put it on another month", async () => {
    m.get.mockResolvedValue(result(withCeiling(five(), "2026-08", noCosts)));
    const latest = await render();
    expect(latest).not.toMatch(NOTICE);
    expect(latest).toContain(">Ceiling<"); // August is still marked in the table
    expect(await render({ month: "2026-08" })).toMatch(NOTICE);
  });
});
