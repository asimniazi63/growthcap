import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtraToolDeps } from "../lib/agent/extra-types";
import { setTestNow } from "../lib/clock";
import type { Db } from "../lib/db/client";
import { actions, calendarEvents, products, tenants } from "../lib/db/schema";
import { createTestDb } from "../lib/db/test-db";
import { buildDraftLandingPageTool } from "../lib/landing/tool";
import type { TenantContext } from "../lib/tenancy/context";
import type { EvalEnv } from "./cases";
import { gradeAsync, type EvalRun } from "./graders";
import { LANDING_CASES } from "./landing-cases";

// The landing case is never run against a model here (it costs money). This runs its setup on an in-memory database, lets the
// real draft_landing_page tool propose a page, and checks that the case's database checks pass on that page and fail on a bad one.

const landing = LANDING_CASES[0]!;
let env: EvalEnv;

beforeEach(async () => {
  const db: Db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_solenne", name: "Solenne" }).returning({ id: tenants.id });
  const ctx: TenantContext = { tenantId: t!.id, orgId: "org_solenne", userId: "eval", role: "gc_admin", shop: { domain: "solenne.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" } };
  // As the fixture loader leaves them: handles such as "p_001", which no landing page accepts.
  await db.insert(products).values([
    { tenantId: t!.id, id: "gid://shopify/Product/1", title: "Hero Vitamin C Serum", handle: "p_001", status: "ACTIVE" },
    { tenantId: t!.id, id: "gid://shopify/Product/10", title: "Barrier Cream", handle: "p_010", status: "ACTIVE" },
    { tenantId: t!.id, id: "gid://shopify/Product/21", title: "Barrier Cream Mini", handle: "p_021", status: "ACTIVE" },
  ]);
  env = { store: "solenne", db, ctx } as EvalEnv;
  setTestNow(landing.now);
}, 60_000);

afterEach(() => setTestNow(null));

const run = (over: Partial<EvalRun> = {}): EvalRun => ({
  answer: "The landing page draft for Black Friday and Cyber Monday 2026 is waiting for approval. A person publishes it in the Shopify admin.",
  toolCalls: [
    { tool: "search_products", input: { query: "serum" } },
    { tool: "draft_landing_page", input: { campaignId: "Black Friday and Cyber Monday 2026" } },
  ],
  views: [],
  verification: null,
  ...over,
});
const failed = async (r: EvalRun) => (await gradeAsync(r, landing.expect(env))).filter((k) => !k.ok).map((k) => k.name);

async function draftThroughTheRealTool(): Promise<void> {
  const d: ExtraToolDeps = { ctx: env.ctx, db: env.db, model: {} as never, now: new Date("2026-11-02T17:00:00Z"), calls: new Map(), write: vi.fn(), onStep: vi.fn() };
  const tool = buildDraftLandingPageTool(d);
  const result = (await tool.execute!(
    {
      campaignId: "Black Friday and Cyber Monday 2026",
      headline: "Our biggest weekend of the year",
      subhead: "Skincare favourites together in one place.",
      bullets: ["Barrier support for dry skin", "Gentle daily routines"],
      ctaLabel: "Shop the weekend",
      productHandles: ["hero-vitamin-c-serum", "barrier-cream"],
    } as never,
    { toolCallId: "t", messages: [], context: {} } as never,
  )) as unknown as Record<string, unknown>;
  expect(result.error).toBeUndefined();
  expect(result.proposed).toBe(true);
}

describe("the landing case's setup", () => {
  it("loads the calendar, gives products the handles a live store has, and clears earlier proposals", async () => {
    await landing.setup!(env);
    const titles = (await env.db.select({ title: calendarEvents.title }).from(calendarEvents).where(eq(calendarEvents.tenantId, env.ctx.tenantId))).map((e) => e.title);
    expect(titles).toContain("Black Friday and Cyber Monday 2026");
    expect(titles).toContain("Black Friday and Cyber Monday 2025");
    const handles = (await env.db.select({ handle: products.handle }).from(products).where(eq(products.tenantId, env.ctx.tenantId))).map((p) => p.handle).sort();
    expect(handles).toEqual(["barrier-cream", "barrier-cream-mini", "hero-vitamin-c-serum"]);
    expect(await env.db.select().from(actions)).toEqual([]);
  });
});

describe("the landing case's checks, on a page the real tool proposed", () => {
  it("pass for a good run", async () => {
    await landing.setup!(env);
    await draftThroughTheRealTool();
    expect(await failed(run())).toEqual([]);
  });

  it("fail when no page was proposed, whatever the answer says", async () => {
    await landing.setup!(env);
    const names = await failed(run());
    expect(names).toEqual([
      "left a landing_page action in status proposed in the ledger",
      "the proposed page belongs to the Black Friday and Cyber Monday 2026 campaign",
      "the saved section reads every price with | money",
      "the saved files contain no currency symbol or code",
      "every product shown has a handle that exists in the store",
    ]);
  });

  it("fail when the saved files type a price, drop | money, or show a product that does not exist", async () => {
    await landing.setup!(env);
    await draftThroughTheRealTool();
    const [row] = await env.db.select().from(actions);
    const payload = row!.payload as { files: { path: string; content: string }[] };
    const section = payload.files.find((f) => f.path.startsWith("sections/"))!;
    const edited = (content: string) => env.db.update(actions).set({ payload: { ...payload, files: payload.files.map((f) => (f === section ? { ...f, content } : f)) } }).where(eq(actions.id, row!.id));

    await edited(section.content.replace("{{ p.price | money }}", "{{ p.price }}"));
    expect(await failed(run())).toEqual(["the saved section reads every price with | money"]);

    await edited(section.content.replace("<h1", "<p>Only $18.00 today</p><h1"));
    expect(await failed(run())).toEqual(["the saved files contain no currency symbol or code"]);

    await edited(section.content.replace("all_products['barrier-cream']", "all_products['made-up-cream']"));
    expect(await failed(run())).toEqual(["every product shown has a handle that exists in the store"]);
  });

  it("fail when the page is for another campaign, or was already decided", async () => {
    await landing.setup!(env);
    await draftThroughTheRealTool();
    const [row] = await env.db.select().from(actions);
    const payload = row!.payload as Record<string, unknown>;
    await env.db.update(actions).set({ payload: { ...payload, campaignId: "00000000-0000-4000-8000-000000000000" } }).where(eq(actions.id, row!.id));
    expect(await failed(run())).toEqual(["the proposed page belongs to the Black Friday and Cyber Monday 2026 campaign"]);

    await env.db.update(actions).set({ payload, status: "done" }).where(eq(actions.id, row!.id));
    expect((await failed(run())).slice(0, 1)).toEqual(["left a landing_page action in status proposed in the ledger"]);
  });

  it("fail an answer that says the page is live, or never says it is waiting", async () => {
    await landing.setup!(env);
    await draftThroughTheRealTool();
    expect(await failed(run({ answer: "Your landing page is now live on the store." }))).toEqual(["says the page is waiting for approval", "does not claim the page was published or is live"]);
    expect(await failed(run({ answer: "I've published the landing page. It is waiting for approval of the theme." }))).toEqual(["does not claim the page was published or is live"]);
    expect(await failed(run({ answer: "The draft is ready and pending approval; nothing has been published, and it is not live." }))).toEqual([]);
    expect(await failed(run({ toolCalls: [{ tool: "draft_landing_page", input: { campaignId: "Black Friday" } }] }))).toEqual([
      "called search_products",
      "named the Black Friday and Cyber Monday 2026 campaign (by its title or its id)",
    ]);
  });
});
