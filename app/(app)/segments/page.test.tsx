import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SegmentCustomer } from "@/lib/segments/definitions";
import type { MapPoint } from "@/lib/segments/map";
import type { TenantContext } from "@/lib/tenancy/context";
import SegmentsPage from "./page";

// The session, the database handle and the loader are mocked; the real page, components and summary maths run. This checks the page's
// states (signed out, wrong role, error, empty, store disconnected, data) and that the role gates what is on the screen.
const m = vi.hoisted(() => ({ ctx: vi.fn<() => Promise<TenantContext>>(), load: vi.fn(), map: vi.fn() }));
vi.mock("@/lib/tenancy/context", () => ({ getTenantContext: m.ctx }));
// The customer map is a client component that needs the app router; the real one still renders, behind a spy that records what the page gave it.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/segments/customer-map", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/segments/customer-map")>();
  return {
    ...real,
    CustomerMap: (props: Parameters<typeof real.CustomerMap>[0]) => {
      m.map(props);
      return real.CustomerMap(props);
    },
  };
});
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ fake: "db" }) }));
vi.mock("@/lib/metrics/segments", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/metrics/segments")>()), loadSegmentCustomers: m.load }));

const shop = { domain: "solenne.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" as const };
const session = (over: Partial<TenantContext> = {}): TenantContext => ({ tenantId: "tenant-a", orgId: "org_a", userId: "user_a", role: "gc_partner", shop, ...over });
const customer = (over: Partial<SegmentCustomer>): SegmentCustomer => ({
  customerId: "CUST_a",
  orders: 3,
  firstOrderDate: "2026-01-02",
  lastOrderDate: "2026-09-20",
  daysSinceLast: 30,
  ltvCents: 12_345,
  medianGapDays: 40,
  r: 5,
  f: 4,
  m: 4,
  churnRisk: 0.1,
  segment: "champions",
  ...over,
});
const customers = [customer({ customerId: "CUST_champ" }), customer({ customerId: "CUST_risk", segment: "at_risk", r: 2, daysSinceLast: 150 }), customer({ customerId: "CUST_act", segment: "active", orders: 1 })];

const render = async (segment?: string) => renderToStaticMarkup(await SegmentsPage({ searchParams: Promise.resolve(segment === undefined ? {} : { segment }) }));

beforeEach(() => {
  vi.clearAllMocks();
  m.ctx.mockResolvedValue(session());
  m.load.mockResolvedValue({ asOf: "2026-10-31", customers });
});

describe("the Segments page", () => {
  it("shows a forbidden banner with no session, and loads nothing", async () => {
    m.ctx.mockRejectedValue(new Error("no session"));
    const out = await render();
    expect(out).toContain('role="alert"');
    expect(out).not.toContain("CUST_");
    expect(m.load).not.toHaveBeenCalled();
  });

  it("tells a client viewer it is for Growth Capital roles only, and loads nothing", async () => {
    m.ctx.mockResolvedValue(session({ role: "client_viewer" }));
    const out = await render();
    expect(out).toContain("Growth Capital roles only");
    expect(out).not.toContain("CUST_");
    expect(out).not.toContain("/api/segments/export");
    expect(m.load).not.toHaveBeenCalled();
  });

  it("shows an error banner when the segments cannot be loaded", async () => {
    m.load.mockRejectedValue(new Error("db down"));
    const out = await render();
    expect(out).toContain('role="alert"');
    expect(out).toContain("Something went wrong on our side");
    expect(out).not.toContain("db down");
  });

  it("says there is nothing to segment when the brand has no customers", async () => {
    m.load.mockResolvedValue({ asOf: "", customers: [] });
    const out = await render();
    expect(out).toContain("No customers to segment yet");
    expect(out).not.toContain("<table");
  });

  it("loads the signed-in brand and shows the cards, the grid, the top customers and the note", async () => {
    const out = await render();
    expect(m.load).toHaveBeenCalledWith({ fake: "db" }, "tenant-a");
    expect(out).toContain("3 customers with at least one order, as of 2026-10-31");
    expect(out.match(/<article /g)).toHaveLength(4);
    expect(out).toContain("Recency 5, frequency 4: 2 customers"); // the champion and the active customer
    expect(out).toContain("Recency 2, frequency 4: 1 customer<");
    expect(out).toContain('href="/api/segments/export"'); // all segments
    expect(out).toContain('href="/api/segments/export?segment=at_risk"');
    expect(out).toContain("pseudonymous ids");
    expect(out).toContain("no emails");
    expect(out).toContain("Active customers: 1 (33.3%)");
    expect(out).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); // no email-looking text anywhere
  });

  it("puts the customer map between the segment cards and the recency grid, with only the six fields it draws", async () => {
    const out = await render("at_risk");
    expect(out).toContain(">Customer map</h2>");
    expect(out).toContain("predicts nothing");
    expect(out.indexOf("segment-champions")).toBeLessThan(out.indexOf("map-heading"));
    expect(out.indexOf("map-heading")).toBeLessThan(out.indexOf("rfm-heading"));
    expect(out.indexOf("rfm-heading")).toBeLessThan(out.indexOf("top-heading"));
    expect(m.map).toHaveBeenCalledTimes(1);
    const props = m.map.mock.calls[0]![0] as { points: MapPoint[]; currency: string; listed: string };
    expect(props.listed).toBe("at_risk"); // the table's segment, so the map knows which rows are in it
    expect(props.currency).toBe("USD");
    expect(props.points).toHaveLength(3);
    expect(props.points[1]).toEqual({ id: "CUST_risk", orders: 3, ltvCents: 12_345, daysSinceLast: 150, churnRisk: 0.1, segment: "at_risk" });
    for (const point of props.points) expect(Object.keys(point).sort()).toEqual(["churnRisk", "daysSinceLast", "id", "ltvCents", "orders", "segment"]);
    expect(out).toContain("Showing all 3 customers.");
  });

  it("does not draw the map when there is nobody to segment", async () => {
    m.load.mockResolvedValue({ asOf: "", customers: [] });
    const out = await render();
    expect(out).not.toContain("Customer map");
    expect(m.map).not.toHaveBeenCalled();
  });

  it("lists the customers of the segment in ?segment=, and of the first segment for anything else", async () => {
    const risk = await render("at_risk");
    expect(risk).toContain("CUST_risk");
    expect(risk).not.toContain("CUST_champ");
    const fallback = await render("not-a-segment");
    expect(fallback).toContain("CUST_champ");
    expect(fallback).not.toContain("CUST_risk");
  });

  it("keeps the data but switches the downloads and the Shopify control off when the store is disconnected", async () => {
    m.ctx.mockResolvedValue(session({ shop: { ...shop, status: "disconnected" } }));
    const out = await render();
    expect(out).toContain("The store needs reconnecting");
    expect(out).toContain("CUST_champ");
    expect(out).not.toContain("/api/segments/export");
    expect(out).not.toContain("/chat?q=");
    expect(out).toContain('aria-disabled="true"');
  });
});
