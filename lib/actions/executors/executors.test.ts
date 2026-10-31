import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../db/client";
import { orders, planTargets, plans, tenants } from "../../db/schema";
import { createTestDb } from "../../db/test-db";
import { AppError } from "../../errors";
import type { TenantContext } from "../../tenancy/context";
import type { ExecEnv } from "../types";
import { annotationExecutor } from "./annotation";
import { discountDeactivateExecutor } from "./discount-deactivate";
import { metricTargetExecutor } from "./metric-target";

let db: Db;
let ctx: TenantContext;

beforeEach(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_a", name: "A" }).returning({ id: tenants.id });
  ctx = { tenantId: t!.id, orgId: "org_a", userId: "u1", role: "gc_partner", shop: { domain: "a.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" } };
}, 60_000);

// A fake Admin API: answers each call from a list and remembers what it was sent.
function fakeEnv(...answers: unknown[]) {
  const sent: { query: string; variables: unknown }[] = [];
  const graphql = vi.fn(async (query: string, variables?: unknown) => {
    sent.push({ query, variables });
    return answers.shift();
  });
  return { env: { db, ctx, graphql } as ExecEnv, sent, graphql };
}

describe("metric_target", () => {
  const e = metricTargetExecutor;
  const good = { metric: "net_sales", month: "2026-11", value: 1_200_000 };

  it("has a strict payload", () => {
    expect(e.schema.safeParse(good).success).toBe(true);
    expect(e.schema.safeParse({ metric: "orders", month: "2026-12", value: 250 }).success).toBe(true);
    for (const bad of [
      { ...good, tenantId: "t" },
      { ...good, metric: "aov" },
      { ...good, month: "2026-13" },
      { ...good, month: "2026-11-01" },
      { ...good, value: 0 },
      { ...good, value: -5 },
      { ...good, value: 10.5 },
      { metric: "net_sales", month: "2026-11" },
    ]) {
      expect(e.schema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("builds the mutation offline: dollars as a decimal string, the whole month as the dates", () => {
    const [m] = e.mutations(good as never);
    expect(m!.name).toBe("analyticsTargetCreate");
    expect(m!.variables).toEqual({
      input: { metric: "total_sales", name: "Oasis plan: Total sales, November 2026", expectedValue: "12000.00", startDate: "2026-11-01", endDate: "2026-11-30" },
    });
    const variables = (v: number) => (e.mutations({ metric: "net_sales", month: "2026-02", value: v })[0]!.variables as { input: { expectedValue: string; endDate: string } }).input;
    expect(variables(1_234_505).expectedValue).toBe("12345.05");
    expect(variables(5).expectedValue).toBe("0.05");
    expect(variables(5).endDate).toBe("2026-02-28");
    expect(e.mutations({ metric: "orders", month: "2026-11", value: 250 })[0]!.variables).toMatchObject({ input: { metric: "orders", expectedValue: "250" } });
  });

  it("runs the mutation and fails on userErrors", async () => {
    const ok = fakeEnv({ analyticsTargetCreate: { analyticsTarget: { id: "gid://shopify/AnalyticsTarget/1" }, userErrors: [] } });
    expect(await e.run(good as never, ok.env)).toEqual({ target: { id: "gid://shopify/AnalyticsTarget/1" } });
    expect(ok.sent).toHaveLength(1);
    expect(ok.sent[0]!.query).toContain("analyticsTargetCreate(input: $input)");
    expect(ok.sent[0]!.variables).toEqual(e.mutations(good as never)[0]!.variables);

    const refused = fakeEnv({ analyticsTargetCreate: { analyticsTarget: null, userErrors: [{ field: ["input"], message: "has already been taken", code: "TAKEN" }] } });
    await expect(e.run(good as never, refused.env)).rejects.toThrow(/already been taken/);
    await expect(e.run(good as never, fakeEnv(undefined).env)).rejects.toBeInstanceOf(AppError);
  });

  it("shows the plan's current target as the before", async () => {
    const [plan] = await db.insert(plans).values({ tenantId: ctx.tenantId, label: "Plan", source: "fixture" }).returning({ id: plans.id });
    await db.insert(planTargets).values({ tenantId: ctx.tenantId, planId: plan!.id, month: "2026-11", metric: "net_sales", value: 650_688 });
    const withPlan = await e.diff(good as never, ctx, db);
    expect(withPlan.rows![0]).toMatchObject({ before: "$6,506.88 (current plan)", after: "$12,000.00" });
    expect(withPlan.summary).toContain("$12,000.00");
    expect(withPlan.summary).toContain("November 2026");
    const none = await e.diff({ metric: "orders", month: "2026-11", value: 250 }, ctx, db);
    expect(none.rows![0]).toMatchObject({ before: "No target in the plan", after: "250" });
  });
});

describe("annotation", () => {
  const e = annotationExecutor;
  const good = { date: "2026-11-27", title: "Black Friday starts", text: "Free shipping on orders over $75" };

  it("has a strict payload", () => {
    expect(e.schema.safeParse(good).success).toBe(true);
    for (const bad of [
      { ...good, shop: "x.myshopify.com" },
      { ...good, date: "2026-02-30" },
      { ...good, date: "27/11/2026" },
      { ...good, title: "x".repeat(76) },
      { ...good, text: "x".repeat(151) },
      { ...good, title: "" },
      { date: good.date, title: good.title },
    ]) {
      expect(e.schema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(e.schema.safeParse({ ...good, title: "x".repeat(75), text: "y".repeat(150) }).success).toBe(true);
  });

  it("puts the user's text in variables only", () => {
    const nasty = { ...good, title: 'Sale") { id } #', text: "$input ${x} \\ \"quoted\"" };
    const [m] = e.mutations(nasty);
    expect(m!.query).toBe(e.mutations(good)[0]!.query);
    expect(m!.query).not.toContain("Sale");
    expect(m!.query).not.toContain("quoted");
    expect(m!.variables).toEqual({ input: { type: "other", title: nasty.title, description: nasty.text, startedAt: "2026-11-27T12:00:00Z" } });
  });

  it("runs the mutation and fails on userErrors", async () => {
    const ok = fakeEnv({ analyticsAnnotationCreate: { analyticsAnnotation: { id: "gid://shopify/AnalyticsAnnotation/9" }, userErrors: [] } });
    expect(await e.run(good, ok.env)).toEqual({ annotation: { id: "gid://shopify/AnalyticsAnnotation/9" } });
    expect(ok.sent[0]!.query).toContain("analyticsAnnotationCreate(input: $input)");
    expect(ok.sent[0]!.variables).toEqual(e.mutations(good)[0]!.variables);

    const refused = fakeEnv({ analyticsAnnotationCreate: { analyticsAnnotation: null, userErrors: [{ field: null, message: "limit reached", code: "LIMIT_REACHED" }] } });
    await expect(e.run(good, refused.env)).rejects.toThrow(/limit reached/);
  });
});

describe("discount_deactivate", () => {
  const e = discountDeactivateExecutor;
  const good = { code: "VIPGLOW25" };

  it("has a strict payload", () => {
    expect(e.schema.safeParse(good).success).toBe(true);
    expect(e.schema.safeParse({ code: "A".repeat(30) }).success).toBe(true);
    for (const bad of [{ ...good, id: "gid://shopify/DiscountCodeNode/1" }, { code: "vipglow25" }, { code: "VIP GLOW" }, { code: 'X") { id }' }, { code: "A".repeat(31) }, { code: "" }, {}]) {
      expect(e.schema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("shows the lookup and the deactivation offline, with the code only in variables", () => {
    const [lookup, deactivate] = e.mutations(good);
    expect(lookup).toMatchObject({ name: "codeDiscountNodeByCode", variables: { code: "VIPGLOW25" } });
    expect(deactivate!.name).toBe("discountCodeDeactivate");
    expect(lookup!.query).not.toContain("VIPGLOW25");
    expect(deactivate!.query).not.toContain("VIPGLOW25");
  });

  it("looks up the id from the code, then deactivates that id", async () => {
    const f = fakeEnv(
      { codeDiscountNodeByCode: { id: "gid://shopify/DiscountCodeNode/573" } },
      { discountCodeDeactivate: { codeDiscountNode: { id: "gid://shopify/DiscountCodeNode/573" }, userErrors: [] } },
    );
    expect(await e.run(good, f.env)).toEqual({ code: "VIPGLOW25", discount: { id: "gid://shopify/DiscountCodeNode/573" } });
    expect(f.sent).toHaveLength(2);
    expect(f.sent[0]!.query).toContain("codeDiscountNodeByCode");
    expect(f.sent[0]!.variables).toEqual({ code: "VIPGLOW25" });
    expect(f.sent[1]!.query).toContain("discountCodeDeactivate(id: $id)");
    expect(f.sent[1]!.variables).toEqual({ id: "gid://shopify/DiscountCodeNode/573" });
  });

  it("sends no deactivation when the code does not exist, and fails on userErrors", async () => {
    const missing = fakeEnv({ codeDiscountNodeByCode: null });
    await expect(e.run(good, missing.env)).rejects.toThrow(/No discount code VIPGLOW25/);
    expect(missing.graphql).toHaveBeenCalledTimes(1);

    const refused = fakeEnv(
      { codeDiscountNodeByCode: { id: "gid://shopify/DiscountCodeNode/573" } },
      { discountCodeDeactivate: { codeDiscountNode: null, userErrors: [{ field: ["id"], message: "Discount does not exist", code: "INVALID" }] } },
    );
    await expect(e.run(good, refused.env)).rejects.toThrow(/Discount does not exist/);
  });

  it("notes whether synced orders ever used the code", async () => {
    const never = await e.diff(good, ctx, db);
    expect(never.notes![0]).toMatch(/No synced order used VIPGLOW25/);
    await db.insert(orders).values({
      tenantId: ctx.tenantId, id: "o1", name: "#1001", processedAt: new Date("2026-10-05T15:00:00Z"), localDate: "2026-10-05",
      grossCents: 5000, discountCents: 500, shippingCents: 0, discountCode: "VIPGLOW25", channel: "web",
    });
    const used = await e.diff(good, ctx, db);
    expect(used.notes![0]).toBe("VIPGLOW25 appears on 1 synced order.");
    expect(used.rows![0]).toMatchObject({ after: "Deactivated" });
  });
});
