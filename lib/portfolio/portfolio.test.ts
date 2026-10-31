import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../db/client";
import { shopConnections, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { NotAllowedError } from "../memory/store";
import type { PlanGap } from "../pace/gap";
import type { PaceView } from "../pace/view";
import type { TenantContext } from "../tenancy/context";
import type { DriverTreeResult } from "../why/types";
import { roleFromClerk, type OrgRole } from "./memberships";
import { getPortfolio } from "./portfolio";

let db: Db;
let ids: Record<string, string>;
const me = (role: TenantContext["role"] = "gc_partner"): TenantContext => ({ tenantId: ids.alpha!, orgId: "org_alpha", userId: "user_me", role, shop: null });

const gapOf = (gap: number): PlanGap => ({ month: "2026-10", target: 1_000_000, planned: 600_000, actual: 600_000 + gap, gap, pctGap: gap / 600_000, projected: 950_000, spread: "even", throughDate: "2026-10-30" });
const view = (over: Partial<PaceView> = {}, gap?: number): PaceView => ({
  today: "2026-10-31",
  month: "2026-10",
  through: "2026-10-30",
  started: true,
  demoClock: false,
  hasPlan: true,
  planLabel: "Plan",
  asOf: "2026-10-31T00:00:00.000Z",
  thisMonth: { range: { from: "2026-10-01", to: "2026-10-30" }, gaps: gap === undefined ? undefined : { net_sales: gapOf(gap) }, queryId: "q_1" },
  lastMonth: null,
  ...over,
});
const gaps: Record<string, number> = { org_alpha: -50_000, org_beta: -120_000, org_gamma: 30_000 };
const memberships = (rows: OrgRole[]) => async () => rows;
const everyone: OrgRole[] = [
  { orgId: "org_alpha", role: "gc_partner" },
  { orgId: "org_beta", role: "gc_admin" },
  { orgId: "org_gamma", role: "gc_partner" },
];

beforeEach(async () => {
  db = await createTestDb();
  const rows = await db
    .insert(tenants)
    .values([{ orgId: "org_alpha", name: "Alpha" }, { orgId: "org_beta", name: "Beta" }, { orgId: "org_gamma", name: "Gamma" }, { orgId: "org_delta", name: "Delta" }])
    .returning();
  ids = Object.fromEntries(rows.map((r) => [r.name.toLowerCase(), r.id]));
  await db.insert(shopConnections).values(rows.map((r) => ({ tenantId: r.id, shopDomain: `${r.name.toLowerCase()}.myshopify.com`, timezone: "UTC", currency: "USD" })));
}, 60_000);

describe("the portfolio", () => {
  it("ranks the person's brands by dollars behind plan, using each brand's own gap and their role in it", async () => {
    const seen: TenantContext[] = [];
    const paceView = async (c: TenantContext) => {
      seen.push(c);
      return view({}, gaps[c.orgId]);
    };
    const rows = await getPortfolio(db, me(), { memberships: memberships(everyone), paceView });
    expect(rows.map((r) => r.name)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(rows.map((r) => r.gap?.gap)).toEqual([-120_000, -50_000, 30_000]);
    expect(seen.find((c) => c.orgId === "org_beta")).toMatchObject({ tenantId: ids.beta, role: "gc_admin", userId: "user_me", shop: { status: "connected" } });
  });

  it("leaves out a brand where the person is only a client viewer, and one with no tenant here", async () => {
    const rows = await getPortfolio(db, me(), {
      memberships: memberships([...everyone.slice(0, 2), { orgId: "org_delta", role: "client_viewer" }, { orgId: "org_unknown", role: "gc_admin" }]),
      paceView: async (c) => view({}, gaps[c.orgId]),
    });
    expect(rows.map((r) => r.name)).toEqual(["Beta", "Alpha"]);
  });

  it("is for Growth Capital roles only: a client viewer is refused before anything is read", async () => {
    const list = vi.fn(async () => everyone);
    await expect(getPortfolio(db, me("client_viewer"), { memberships: list })).rejects.toBeInstanceOf(NotAllowedError);
    expect(list).not.toHaveBeenCalled();
  });

  it("shows a plain note for a brand with no plan, no data or a disconnected store, and a failing brand does not stop the rest", async () => {
    await db.update(shopConnections).set({ status: "disconnected" }).where(eq(shopConnections.tenantId, ids.gamma!));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const paceView = async (c: TenantContext) => {
      if (c.orgId === "org_alpha") return view({ hasPlan: false });
      if (c.orgId === "org_beta") throw new Error("boom");
      return view({}, 0);
    };
    const rows = await getPortfolio(db, me(), { memberships: memberships(everyone), paceView });
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.Alpha).toMatchObject({ gap: null, note: "No plan is loaded for this brand." });
    expect(byName.Beta).toMatchObject({ gap: null, note: "This brand's figures could not be loaded." });
    expect(byName.Gamma).toMatchObject({ gap: null, note: "The store is not connected." });
  });

  it("adds the top driver from the driver tree, and only the gap when it has none", async () => {
    const tree = (drivers: DriverTreeResult["drivers"]) => async (): Promise<DriverTreeResult> => ({ month: "2026-10", targetCents: 0, actualCents: 0, gapCents: 0, drivers });
    const driver = { id: "d1", kind: "new_customer_orders" as const, label: "New-customer orders", deltaCents: -80_000, shareOfGap: 0.6, planned: 100, actual: 80, unit: "count" as const };
    const deps = { memberships: memberships(everyone.slice(0, 1)), paceView: async () => view({}, -50_000) };
    expect((await getPortfolio(db, me(), { ...deps, driverTree: tree([driver]) }))[0]!.driver).toEqual({ label: "New-customer orders", deltaCents: -80_000 });
    expect((await getPortfolio(db, me(), { ...deps, driverTree: tree([]) }))[0]).toMatchObject({ driver: null, gap: { gap: -50_000 } });
  });
});

describe("Clerk roles", () => {
  it("reads org:<key> and ignores the built-in roles", () => {
    expect(roleFromClerk("org:gc_admin")).toBe("gc_admin");
    expect(roleFromClerk("org:client_viewer")).toBe("client_viewer");
    expect(roleFromClerk("org:admin")).toBeNull();
    expect(roleFromClerk("gc_admin")).toBeNull();
  });
});
