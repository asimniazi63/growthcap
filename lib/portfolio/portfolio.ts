import { inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { tenants } from "../db/schema";
import { AppError } from "../errors";
import { NotAllowedError } from "../memory/store";
import { netSalesSpark, type SparkData } from "../overview/spark";
import type { PlanGap } from "../pace/gap";
import { getPaceView, type PaceView } from "../pace/view";
import { monthName } from "../pace/format";
import { shopFor, tenantScoped, type Role, type TenantContext } from "../tenancy/context";
import { driverTree as realDriverTree } from "../why/driver-tree";
import { clerkMemberships, type MembershipsFn } from "./memberships";

// Every number here is computed by the server from the same metric and plan layer the Pace page and the agent use. The
// page does not call the model.

export interface PortfolioRow {
  tenantId: string;
  name: string;
  currency: string;
  role: Role; // the signed-in person's role in this brand
  gap: PlanGap | null; // net sales this month against plan, through yesterday
  driver: { label: string; deltaCents: number } | null; // the part of the gap that pulled the most
  spark: SparkData | null; // net sales so far this month by day, from the series the Pace view already built
  note: string | null; // why there is no gap to show
}

export interface PortfolioDeps {
  memberships?: MembershipsFn;
  paceView?: (ctx: TenantContext) => Promise<PaceView>;
  driverTree?: typeof realDriverTree;
}

const NOT_CONNECTED = "The store is not connected.";

// The signed-in person's brands, most dollars behind plan first. A brand counts only where they hold a Growth Capital role
// (a brand where they are a client viewer is left out), and the role used for that brand is the one they hold there.
export async function getPortfolio(db: Db, ctx: TenantContext, deps: PortfolioDeps = {}): Promise<PortfolioRow[]> {
  if (ctx.role === "client_viewer") throw new NotAllowedError();

  const roleByOrg = new Map<string, Role>();
  for (const m of await (deps.memberships ?? clerkMemberships)(ctx.userId)) if (m.role !== "client_viewer") roleByOrg.set(m.orgId, m.role);
  if (roleByOrg.size === 0) return [];

  const brands = await db
    .select()
    .from(tenants)
    .where(inArray(tenants.orgId, [...roleByOrg.keys()]));
  const rows = await Promise.all(brands.map((t) => brandRow(db, ctx.userId, t, roleByOrg.get(t.orgId)!, deps)));

  return rows.sort((a, b) => (a.gap && b.gap ? a.gap.gap - b.gap.gap : a.gap ? -1 : b.gap ? 1 : 0) || a.name.localeCompare(b.name));
}

async function brandRow(db: Db, userId: string, t: { id: string; orgId: string; name: string }, role: Role, deps: PortfolioDeps): Promise<PortfolioRow> {
  const shop = await shopFor(tenantScoped(db, t.id));
  const base = { tenantId: t.id, name: t.name, currency: shop?.currency ?? "USD", role, gap: null, driver: null, spark: null };
  if (!shop || shop.status !== "connected") return { ...base, note: NOT_CONNECTED };

  // The context is built for this brand with the person's role there; one brand failing never stops the rest.
  const brand: TenantContext = { tenantId: t.id, orgId: t.orgId, userId, role, shop };
  try {
    const view = await (deps.paceView ?? ((c) => getPaceView(c, { db })))(brand);
    if (!view.hasPlan) return { ...base, note: "No plan is loaded for this brand." };
    if (!view.started) return { ...base, note: "No complete day yet this month." };
    const gap = view.thisMonth?.gaps?.net_sales;
    if (!gap) return { ...base, note: `The plan has no net sales target for ${monthName(view.month)}.` };

    const tree = await (deps.driverTree ?? realDriverTree)(db, t.id, { month: view.month }).catch(() => null);
    const top = tree?.drivers[0]; // largest pull first; empty when the driver work has nothing to say
    return { ...base, gap, driver: top ? { label: top.label, deltaCents: top.deltaCents } : null, spark: netSalesSpark(view.series), note: null };
  } catch (e) {
    const code = e instanceof AppError ? e.code : null;
    if (code === "STORE_DISCONNECTED") return { ...base, note: NOT_CONNECTED };
    if (code === "NO_DATA") return { ...base, note: "No orders have been synced yet." };
    console.error("[portfolio] could not load a brand:", code ?? (e instanceof Error ? e.name : "unknown"));
    return { ...base, note: "This brand's figures could not be loaded." };
  }
}
