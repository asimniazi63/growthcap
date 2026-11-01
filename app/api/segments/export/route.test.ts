import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SegmentCustomer } from "@/lib/segments/definitions";
import type { TenantContext } from "@/lib/tenancy/context";
import { GET } from "./route";

// The session, the database handle and the segment loader are mocked: this file checks only what the route decides on its own (who may
// download, what the query may say, the headers and the file) and that the brand it loads comes from the session.
const m = vi.hoisted(() => ({
  ctx: vi.fn<() => Promise<TenantContext>>(),
  load: vi.fn(),
}));

vi.mock("@/lib/tenancy/context", () => ({ getTenantContext: m.ctx }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ fake: "db" }) }));
vi.mock("@/lib/metrics/segments", () => ({ loadSegmentCustomers: m.load }));

const shop = { domain: "solenne.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" as const };
const session = (over: Partial<TenantContext> = {}): TenantContext => ({ tenantId: "tenant-a", orgId: "org_a", userId: "user_a", role: "gc_partner", shop, ...over });
const get = (query = "") => GET(new Request(`https://x.test/api/segments/export${query}`));

const customer = (over: Partial<SegmentCustomer>): SegmentCustomer => ({
  customerId: "CUST_a",
  orders: 3,
  firstOrderDate: "2026-01-02",
  lastOrderDate: "2026-09-20",
  daysSinceLast: 30,
  ltvCents: 12345,
  medianGapDays: 40,
  r: 5,
  f: 4,
  m: 4,
  churnRisk: 0.1,
  segment: "champions",
  ...over,
});
const customers = [
  customer({ customerId: "CUST_a", segment: "champions", ltvCents: 12345 }),
  customer({ customerId: "CUST_b", segment: "at_risk", ltvCents: 5 }),
  customer({ customerId: "CUST_c", segment: "active", ltvCents: 777 }),
];

beforeEach(() => {
  vi.clearAllMocks();
  m.ctx.mockResolvedValue(session());
  m.load.mockResolvedValue({ asOf: "2026-10-31", customers });
});

describe("GET /api/segments/export", () => {
  it("refuses a client viewer, and a request with no session, before loading anything", async () => {
    m.ctx.mockResolvedValue(session({ role: "client_viewer" }));
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
    m.ctx.mockRejectedValue(new Error("no session"));
    expect((await get("?segment=at_risk")).status).toBe(403);
    expect(m.load).not.toHaveBeenCalled();
  });

  it.each(["gc_admin", "gc_partner"] as const)("lets a %s download", async (role) => {
    m.ctx.mockResolvedValue(session({ role }));
    expect((await get()).status).toBe(200);
  });

  it.each([
    ["an unknown segment", "?segment=vip"],
    ["the active pseudo-segment", "?segment=active"],
    ["a different case", "?segment=AT_RISK"],
    ["an empty value", "?segment="],
    ["a repeated segment", "?segment=at_risk&segment=champions"],
    ["a path-like value", "?segment=..%2F..%2Fetc"],
    ["a header-splitting value", "?segment=at_risk%0d%0aSet-Cookie:x=1"],
  ])("rejects %s with 400 and loads nothing", async (_label, query) => {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_INPUT");
    expect(m.load).not.toHaveBeenCalled();
  });

  it("returns the one segment as a CSV attachment, named from the segment id and the as-of date", async () => {
    const res = await get("?segment=at_risk");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="segments-at_risk-2026-10-31.csv"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("customer_id,segment,orders,ltv,days_since_last_order,r,f,m\nCUST_b,at_risk,3,0.05,30,5,4,4\n");
  });

  it("with no segment returns the four segments (not the active customers), highest lifetime value first", async () => {
    const res = await get();
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="segments-all-2026-10-31.csv"');
    expect(await res.text()).toBe(["customer_id,segment,orders,ltv,days_since_last_order,r,f,m", "CUST_a,champions,3,123.45,30,5,4,4", "CUST_b,at_risk,3,0.05,30,5,4,4", ""].join("\n"));
  });

  it("loads the session's brand, and a tenant named in the query changes nothing", async () => {
    const res = await get("?segment=champions&tenantId=tenant-b&orgId=org_b&brand=tenant-b");
    expect(res.status).toBe(200);
    expect(m.load).toHaveBeenCalledTimes(1);
    expect(m.load).toHaveBeenCalledWith({ fake: "db" }, "tenant-a");
    m.ctx.mockResolvedValue(session({ tenantId: "tenant-z", orgId: "org_z" }));
    await get("?tenantId=tenant-a");
    expect(m.load).toHaveBeenLastCalledWith({ fake: "db" }, "tenant-z");
  });

  it("refuses a disconnected store, or a brand with no store, without loading", async () => {
    m.ctx.mockResolvedValue(session({ shop: { ...shop, status: "disconnected" } }));
    const res = await get();
    expect((await res.json()).error).toBe("STORE_DISCONNECTED");
    m.ctx.mockResolvedValue(session({ shop: null }));
    expect((await (await get("?segment=at_risk")).json()).error).toBe("STORE_DISCONNECTED");
    expect(m.load).not.toHaveBeenCalled();
  });

  it("gives just the header for a brand with no customers, and a file name that still holds only safe characters", async () => {
    m.load.mockResolvedValue({ asOf: "", customers: [] });
    const res = await get("?segment=champions");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("customer_id,segment,orders,ltv,days_since_last_order,r,f,m\n");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="segments-champions-undated.csv"');
  });

  it("answers 500 with a bare error code when loading fails, without the detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    m.load.mockRejectedValue(new Error("connection string postgres://secret"));
    const res = await get();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "INTERNAL_ERROR" });
  });
});
