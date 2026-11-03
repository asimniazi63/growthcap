import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionView, ProposeInput } from "../actions/types";
import type { ExtraToolDeps } from "../agent/extra-types";
import { AppError } from "../errors";
import type { Db } from "../db/client";
import { calendarEvents, products, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import type { TenantContext } from "../tenancy/context";
import { buildLandingFiles, campaignNumbers, esc } from "./build";
import { landingMutations, landingPageExecutor, pickTheme } from "./executor";
import { buildDraftLandingPageTool, draftLandingPageInput } from "./tool";
import type { LandingCampaign, LandingCopy, LandingPayload } from "./types";
import { lintCopy, lintLanding, validateLanding } from "./validate";

let db: Db;
let ctx: TenantContext;
let campaignId: string;

const copy: LandingCopy = {
  headline: "Black Friday at Solenne",
  subhead: "Our best-loved skincare, together in one place for the weekend.",
  bullets: ["Barrier support for dry skin", "Gentle daily routines"],
  ctaLabel: "Shop the sale",
  productHandles: ["hero-vitamin-c-serum", "barrier-cream"],
};
const catalogue = [
  { handle: "hero-vitamin-c-serum", title: "Hero Vitamin C Serum" },
  { handle: "barrier-cream", title: "Barrier Cream" },
];
const bfcm: LandingCampaign = { title: "Black Friday and Cyber Monday 2026", dateFrom: "2026-11-27", dateTo: "2026-11-30", details: "Planned: code and offer to be confirmed in November" };
const handles = new Set(catalogue.map((p) => p.handle));

beforeEach(async () => {
  db = await createTestDb();
  const [t] = await db.insert(tenants).values({ orgId: "org_s", name: "Solenne" }).returning({ id: tenants.id });
  ctx = { tenantId: t!.id, orgId: "org_s", userId: "u1", role: "gc_partner", shop: { domain: "solenne.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" } };
  await db.insert(products).values([
    { tenantId: ctx.tenantId, id: "gid://shopify/Product/1", title: "Hero Vitamin C Serum", handle: "hero-vitamin-c-serum", status: "ACTIVE" },
    { tenantId: ctx.tenantId, id: "gid://shopify/Product/2", title: "Barrier Cream", handle: "barrier-cream", status: "ACTIVE" },
    { tenantId: ctx.tenantId, id: "gid://shopify/Product/3", title: "Old Mask", handle: "old-mask", status: "DRAFT" },
  ]);
  const [c] = await db
    .insert(calendarEvents)
    .values({ tenantId: ctx.tenantId, dateFrom: bfcm.dateFrom, dateTo: bfcm.dateTo, title: bfcm.title, type: "promo", channel: "all", details: bfcm.details! })
    .returning({ id: calendarEvents.id });
  campaignId = c!.id;
}, 60_000);

afterEach(() => vi.unstubAllGlobals());

function deps(over: Partial<ExtraToolDeps> = {}) {
  const write = vi.fn();
  const d: ExtraToolDeps = { ctx, db, model: {} as never, now: new Date("2026-11-02T17:00:00Z"), calls: new Map(), write, onStep: vi.fn(), ...over };
  return { d, write };
}

function fakePropose() {
  const seen: ProposeInput[] = [];
  const propose = vi.fn(async (_db: Db, _ctx: TenantContext, input: ProposeInput): Promise<ActionView> => {
    seen.push(input);
    return {
      id: "3f2b8c9e-4d4a-4f43-9d0e-0a1b2c3d4e5f", kind: input.kind, status: "proposed", title: input.title,
      diff: { summary: "s", notes: ["Theme Check passed", "Theme Check warning: x line 4: y"], files: [] },
      hypothesis: input.hypothesis, metric: input.metric, checkOn: input.checkOn, owner: "u1", dryRun: false, createdAt: "2026-11-02T17:00:00Z",
    };
  });
  return { propose, seen };
}

const run = (tool: ReturnType<typeof buildDraftLandingPageTool>, input: unknown) => tool.execute!(input as never, { toolCallId: "t", messages: [], context: {} }) as unknown as Promise<Record<string, unknown>>;
const toolInput = { campaignId: "Black Friday and Cyber Monday 2026", ...copy };

describe("landing page: the copy is escaped and no price is typed", () => {
  it("escapes HTML and Liquid in the copy", () => {
    const draft = buildLandingFiles({ ...copy, headline: `<b>Big</b> {{ 1 }} & "sale"`, bullets: ["<script>x</script>", "{% if %}"] }, catalogue, { ...bfcm, title: `<img src=x onerror=alert(1)>` });
    const section = draft.files[0]!.content;
    expect(section).not.toContain("<b>Big");
    expect(section).not.toContain("<script>");
    expect(section).not.toContain("<img src=x");
    expect(section).not.toContain("{{ 1 }}");
    expect(section).toContain("&lt;b&gt;Big&lt;/b&gt;");
    expect(esc(`a&b "c" {d}`)).toBe("a&amp;b &quot;c&quot; &#123;d&#125;");
  });

  it("rejects a template with a typed-in price", () => {
    const section = buildLandingFiles(copy, catalogue, bfcm).files[0]!;
    const opts = { handles, allowedNumbers: campaignNumbers(bfcm) };
    expect(lintLanding([section], opts)).toEqual([]);
    for (const typed of ["<p>Only $19.99 today</p>", "<p>Now 19.99</p>", "<p>Just 20 USD</p>", "<p>For 12 dollars</p>", "<p>Buy at 1,299</p>"]) {
      const bad = { ...section, content: section.content.replace("</section>", `${typed}\n</section>`) };
      expect(lintLanding([bad], opts), typed).not.toEqual([]);
    }
  });

  it("keeps the model from typing prices or discounts into the copy, but allows the campaign's own numbers", () => {
    expect(lintCopy({ ...copy, headline: "Everything for $20" })).not.toEqual([]);
    expect(lintCopy({ ...copy, subhead: "Save 40% on the serum" })).not.toEqual([]);
    expect(lintCopy({ ...copy, subhead: "Save 25% on the serum" }, campaignNumbers({ ...bfcm, details: "BFCM25 code (25% off sitewide)" }))).toEqual([]);
    expect(lintCopy({ ...copy, headline: "Black Friday 2026" })).toEqual([]); // a year is fine
    expect(lintCopy({ ...copy, bullets: ["See https://evil.example", "ok"] })).not.toEqual([]);
    expect(lintCopy({ ...copy, bullets: ["<script>alert(1)</script>", "ok"] })).not.toEqual([]);
    expect(lintCopy({ ...copy, ctaLabel: "x onclick=alert(1)" })).not.toEqual([]);
  });

  it("catches a price fused to a word or typed with full-width characters", () => {
    const copy = (headline: string) => ({ headline, subhead: "Plain words.", bullets: ["One", "Two"], ctaLabel: "Shop", productHandles: ["a"] });
    for (const bad of ["Just 29USD today", "Buy2Get1Free", "Only ＄２９ now", "Five bucks off"]) expect(lintCopy(copy(bad)).length, bad).toBeGreaterThan(0);
    expect(lintCopy(copy("Our biggest sale of the year"))).toEqual([]);
  });

  it("sends back copy that claims results, creates urgency or boasts, and names the field and the reason", () => {
    // Every line below is from, or a close cousin of, the draft that went to the store on 2026-11-03.
    const claims: Partial<LandingCopy>[] = [
      { subhead: "The ceramide-rich Barrier Cream that repairs and protects your skin." },
      { bullets: ["Deeply nourishes and restores a damaged skin barrier", "Two sizes"] },
      { bullets: ["Lasting protection all day", "Two sizes"] },
      { bullets: ["Loved for visible results", "Two sizes"] },
      { bullets: ["Two sizes", "Heals dry skin"] },
      { subhead: "Clinically proven and dermatologist approved." },
      { bullets: ["Limited stock — don't miss out this BFCM", "Two sizes"] },
      { bullets: ["Limited stock — don’t miss out", "Two sizes"] },
      { headline: "Last chance to save" },
      { subhead: "Hurry, it is selling fast." },
      { subhead: "Yours while supplies last." },
      { ctaLabel: "Act now" },
      { subhead: "Stock up at our best price." },
      { subhead: "Our lowest price, guaranteed." },
      { bullets: ["A Solenne bestseller", "Two sizes"] },
      { bullets: ["Our best-selling serum", "Two sizes"] },
      { subhead: "The most popular routine, and award-winning." },
    ];
    for (const c of claims) {
      const problems = lintCopy({ ...copy, ...c });
      expect(problems.length, JSON.stringify(c)).toBeGreaterThan(0);
      const field = Object.keys(c)[0]!;
      expect(problems[0], JSON.stringify(c)).toContain(field); // the model is told which field to change
      expect(problems[0], JSON.stringify(c)).toMatch(/claim|urgency|price|popularity/i); // and why
    }
  });

  it("lets plain selling words through, including the ones near the claim words", () => {
    const plain: Partial<LandingCopy>[] = [
      { headline: "Black Friday at Solenne" },
      { subhead: "Treat yourself to our best-loved skincare, together in one place." },
      { subhead: "Our biggest sale of the year." },
      { bullets: ["Barrier support for dry skin", "Available in two sizes"] },
      { bullets: ["Ceramide-rich formula", "Gentle daily routines"] },
      { bullets: ["The sale runs to the end of the weekend", "Free to browse"] },
      { ctaLabel: "Shop the sale" },
    ];
    for (const c of plain) expect(lintCopy({ ...copy, ...c }), JSON.stringify(c)).toEqual([]);
  });

  it("reads prices and stock from the store, never from the file", () => {
    const section = buildLandingFiles(copy, catalogue, bfcm).files[0]!.content;
    expect(section).toContain("{{ p.price | money }}");
    expect(section).toContain("p.available");
    expect(section).toContain("all_products['hero-vitamin-c-serum']");
    expect(section).not.toMatch(/[$€£]/);
  });
});

describe("landing page: handles and Liquid are checked", () => {
  it("rejects a product handle the store does not have", async () => {
    expect(() => buildLandingFiles({ ...copy, productHandles: ["no-such-product"] }, catalogue, bfcm)).toThrow(/no-such-product/);
    const section = buildLandingFiles(copy, catalogue, bfcm).files[0]!;
    expect(lintLanding([section], { handles: new Set(["barrier-cream"]) }).join(" ")).toContain("hero-vitamin-c-serum");

    const { d, write } = deps();
    const { propose } = fakePropose();
    const out = await run(buildDraftLandingPageTool(d, propose), { ...toolInput, productHandles: ["hero-vitamin-c-serum", "old-mask", "ghost"] });
    expect((out.error as { code: string; message: string }).code).toBe("INVALID_INPUT");
    expect((out.error as { message: string }).message).toMatch(/old-mask.*ghost/);
    expect(propose).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("passes Theme Check for a good draft, and fails invalid Liquid", async () => {
    const draft = buildLandingFiles(copy, catalogue, bfcm);
    const good = await validateLanding(draft.files, { handles, allowedNumbers: campaignNumbers(bfcm) });
    expect(good.problems).toEqual([]);
    expect(good.ok).toBe(true);
    expect(good.notes).toContain("Theme Check passed");

    const broken = draft.files.map((f) => (f.path.endsWith(".liquid") ? { ...f, content: f.content.replace("{%- endif -%}", "") } : f));
    const bad = await validateLanding(broken, { handles, allowedNumbers: campaignNumbers(bfcm) });
    expect(bad.ok).toBe(false);
    expect(bad.problems.join(" ")).toMatch(/Theme Check/);
  }, 60_000);
});

describe("draft_landing_page tool", () => {
  it("only proposes: it never calls Shopify, and the card goes to the browser", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { d, write } = deps();
    const { propose, seen } = fakePropose();
    const out = await run(buildDraftLandingPageTool(d, propose), toolInput);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out).toMatchObject({ proposed: true, actionId: "3f2b8c9e-4d4a-4f43-9d0e-0a1b2c3d4e5f", needsApproval: true, checks: ["Theme Check passed"] });
    expect(propose).toHaveBeenCalledTimes(1);
    const input = seen[0]!;
    expect(input).toMatchObject({ kind: "landing_page", metric: "net_sales", checkOn: "2026-11-30" });
    const payload = input.payload as LandingPayload;
    expect(payload).toMatchObject({ campaignId, handles: ["hero-vitamin-c-serum", "barrier-cream"] });
    expect(payload.files.map((f) => f.path)).toEqual([`sections/oasis-landing-${payload.slug}.liquid`, `templates/page.oasis-landing-${payload.slug}.json`]);
    expect(landingPageExecutor.schema.safeParse(payload).success).toBe(true);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ type: "data-action" }));
  }, 60_000);

  it("rejects fields the model should not have, and gives a recoverable error for a bad copy", async () => {
    const { d } = deps();
    const { propose } = fakePropose();
    const tool = buildDraftLandingPageTool(d, propose);
    expect(draftLandingPageInput.safeParse({ ...toolInput, tenantId: "x" }).success).toBe(false);
    expect(draftLandingPageInput.safeParse(toolInput).success).toBe(true);
    const out = await run(tool, { ...toolInput, subhead: "Only $9.99 this weekend" });
    expect((out.error as { code: string }).code).toBe("INVALID_INPUT");
    const neither = await run(tool, { ...copy });
    expect((neither.error as { message: string }).message).toMatch(/campaignId or productHandle/);
    expect(propose).not.toHaveBeenCalled();
  });

  it("names the planned campaigns when it can't find the one asked for, and reads only this brand's calendar", async () => {
    const { d } = deps();
    const { propose } = fakePropose();
    const out = await run(buildDraftLandingPageTool(d, propose), { ...toolInput, campaignId: "Easter picnic" });
    expect((out.error as { message: string }).message).toContain(campaignId);
    const [other] = await db.insert(tenants).values({ orgId: "org_o", name: "Other" }).returning({ id: tenants.id });
    const theirs = deps({ ctx: { ...ctx, tenantId: other!.id } });
    const none = await run(buildDraftLandingPageTool(theirs.d, propose), { ...toolInput, campaignId });
    expect((none.error as { message: string }).message).not.toContain(campaignId);
  });
});

describe("landing page executor", () => {
  const draft = buildLandingFiles(copy, catalogue, bfcm);
  const payload: LandingPayload = { files: draft.files, slug: draft.slug, title: draft.title, handles: copy.productHandles };

  it("has a strict payload that can write only the two pinned files", () => {
    expect(landingPageExecutor.schema.safeParse(payload).success).toBe(true);
    expect(landingPageExecutor.schema.safeParse({ ...payload, tenantId: "t" }).success).toBe(false);
    const other = { ...payload, files: [payload.files[0]!, { path: "layout/theme.liquid", content: "x" }] };
    expect(landingPageExecutor.schema.safeParse(other).success).toBe(false);
  });

  it("builds its mutations offline, with prices from `| money`, and a page that stays hidden", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const ms = landingPageExecutor.mutations(payload);
    expect(ms.map((m) => m.name)).toEqual(["themes", "themeFilesUpsert", "pageCreate"]);
    expect(ms[0]!.query).toContain("UNPUBLISHED");
    const files = (ms[1]!.variables as { files: { filename: string; body: { type: string; value: string } }[] }).files;
    expect(files.map((f) => f.filename)).toEqual(draft.files.map((f) => f.path));
    expect(files[0]!.body.value).toContain("| money");
    expect(ms[2]!.variables).toMatchObject({ page: { isPublished: false, templateSuffix: `oasis-landing-${draft.slug}` } });
    expect(landingMutations(payload)).toEqual(ms);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the code and the check result on the card", async () => {
    const diff = await landingPageExecutor.diff({ ...payload, campaignId }, ctx, db);
    expect(diff.files?.map((f) => f.path)).toEqual(draft.files.map((f) => f.path));
    expect(diff.notes).toContain("Theme Check passed");
    expect(diff.mutations).toHaveLength(3);
    await expect(landingPageExecutor.diff({ ...payload, handles: ["hero-vitamin-c-serum", "barrier-cream", "old-mask"] }, ctx, db)).rejects.toThrow(/old-mask/);
  }, 60_000);

  it("writes into the unpublished theme and creates a hidden page, never touching the live theme", async () => {
    const sent: { query: string; variables: unknown }[] = [];
    const answers: unknown[] = [
      { themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/1", name: "Solenne live", role: "UNPUBLISHED", processing: false }, { id: "gid://shopify/OnlineStoreTheme/2", name: "Copy of Solenne", role: "UNPUBLISHED", processing: false }] } },
      { themeFilesUpsert: { upsertedThemeFiles: draft.files.map((f) => ({ filename: f.path })) } },
      { pageCreate: { page: { id: "gid://shopify/Page/9", title: draft.title, handle: `oasis-${draft.slug}`, isPublished: false } } },
    ];
    const graphql = vi.fn(async (query: string, variables?: unknown) => {
      sent.push({ query, variables });
      return answers.shift();
    });
    const result = (await landingPageExecutor.run(payload, { db, ctx, graphql })) as Record<string, unknown>;
    expect(sent[1]!.variables).toMatchObject({ themeId: "gid://shopify/OnlineStoreTheme/2" });
    expect(result).toMatchObject({ themeId: "gid://shopify/OnlineStoreTheme/2", pageId: "gid://shopify/Page/9", handle: `oasis-${draft.slug}`, published: false });
    expect(String(result.editorUrlHint)).toContain("/store/solenne/themes/2/editor");
  });

  describe("when the page is already in the store", () => {
    const taken = () => new AppError("INVALID_INPUT", "Shopify refused the change: page.handle: Handle has already been taken");
    const theme = { themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/2", name: "Copy of Solenne", role: "UNPUBLISHED", processing: false }] } };
    const page = (templateSuffix: string | null) => ({ pages: { nodes: [{ id: "gid://shopify/Page/9", title: draft.title, handle: `oasis-${draft.slug}`, isPublished: false, templateSuffix }] } });
    const fakeShopify = (existing: unknown) =>
      vi.fn<(query: string, variables?: unknown) => Promise<unknown>>(async (query) => {
        if (query.includes("themeFilesUpsert")) return { themeFilesUpsert: { upsertedThemeFiles: draft.files.map((f) => ({ filename: f.path })) } };
        if (query.includes("pageCreate")) throw taken();
        if (query.includes("OasisPageByHandle")) return existing;
        return theme;
      });

    it("counts a page that already uses this template as created, reads it back, and says it existed", async () => {
      const graphql = fakeShopify(page(`oasis-landing-${draft.slug}`));
      const result = (await landingPageExecutor.run(payload, { db, ctx, graphql })) as Record<string, unknown>;
      expect(result).toMatchObject({ pageId: "gid://shopify/Page/9", handle: `oasis-${draft.slug}`, published: false, pageExisted: true });
      const lookup = graphql.mock.calls.find(([q]) => q.includes("OasisPageByHandle"))!;
      expect(lookup[1]).toMatchObject({ q: `handle:oasis-${draft.slug}` });
    });

    it("does not adopt a page at that address that uses another template, or none", async () => {
      for (const existing of [page("contact"), page(null), { pages: { nodes: [] } }]) {
        const graphql = fakeShopify(existing);
        await expect(landingPageExecutor.run(payload, { db, ctx, graphql }), JSON.stringify(existing)).rejects.toThrow(/already been taken/);
      }
    });

    it("lets any other refusal of the page through untouched, and never looks the page up for it", async () => {
      const graphql = vi.fn(async (query: string) => {
        if (query.includes("themeFilesUpsert")) return { themeFilesUpsert: { upsertedThemeFiles: draft.files.map((f) => ({ filename: f.path })) } };
        if (query.includes("pageCreate")) throw new AppError("INVALID_INPUT", "Shopify refused the change: page.title: can't be blank");
        return theme;
      });
      await expect(landingPageExecutor.run(payload, { db, ctx, graphql })).rejects.toThrow(/can't be blank/);
      expect(graphql.mock.calls.some(([q]) => q.includes("OasisPageByHandle"))).toBe(false);
    });
  });

  it("writes nothing and creates no page when Shopify gates theme writes behind an exemption, and says how to finish by hand", async () => {
    const sent: string[] = [];
    const graphql = vi.fn(async (query: string) => {
      sent.push(query);
      if (query.includes("themeFilesUpsert")) throw new AppError("INVALID_INPUT", "Shopify refused the change: Access denied for themeFilesUpsert field. Required access: write_themes and an exemption from Shopify.");
      return { themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/2", name: "Copy of Solenne", role: "UNPUBLISHED", processing: false }] } };
    });
    const result = (await landingPageExecutor.run(payload, { db, ctx, graphql })) as Record<string, unknown>;
    expect(result).toMatchObject({ written: false, themeId: "gid://shopify/OnlineStoreTheme/2" });
    expect(String(result.finishByHand)).toContain("shopify theme push --store solenne.myshopify.com --theme 2");
    expect(sent.some((q) => q.includes("pageCreate"))).toBe(false);
  });

  it("says so when the store has no unpublished theme", async () => {
    const graphql = vi.fn(async () => ({ themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/5", name: "Live", role: "MAIN" }] } }));
    await expect(landingPageExecutor.run(payload, { db, ctx, graphql })).rejects.toThrow(/no unpublished theme/);
    expect(graphql).toHaveBeenCalledTimes(1);
    expect(() => pickTheme([])).toThrow(/duplicate the live theme/);
  });
});

describe("when Theme Check cannot run", () => {
  it("still lints the draft, and says on the card that Theme Check did not run", async () => {
    const failing = vi.fn(async () => {
      throw new Error("ENOENT: no such file or directory, open '/var/task/data/themes.json'");
    });
    const result = await validateLanding(
      [{ path: "sections/a.liquid", content: "{% assign p = all_products['a'] %}<h1>Plain</h1>{{ p.price | money }}" }],
      { handles: new Set(["a"]) },
      { themeCheck: failing },
    );
    expect(result.ok).toBe(true);
    expect(result.notes[0]).toMatch(/Theme Check could not run .*ENOENT/);
    const bad = await validateLanding([{ path: "sections/a.liquid", content: "<script>x</script>" }], { handles: new Set(["a"]) }, { themeCheck: failing });
    expect(bad.ok).toBe(false); // our own lint still fails a bad draft
  });
});
