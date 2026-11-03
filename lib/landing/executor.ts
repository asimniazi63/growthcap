import { z } from "zod";
import type { ActionDiff, ExecEnv, Executor } from "../actions/types";
import { AppError } from "../errors";
import { activeProducts, campaignById } from "./data";
import { campaignNumbers } from "./build";
import { LANDING_KIND, landingPayloadSchema, pageHandle, templateSuffix, type LandingPayload } from "./types";
import { validateLanding } from "./validate";

// The landing page write (kind "landing_page"): the section and the page template go into the store's UNPUBLISHED theme, and
// a hidden page uses the template. Nothing here publishes anything: a person does that in the Shopify admin.
// Scopes: write_themes (themeFilesUpsert, which Shopify also gates behind an exemption request), read_themes (the
// themes query) and write_content or write_online_store_pages (pageCreate).

export const THEMES_QUERY = `query OasisUnpublishedThemes {
  themes(first: 20, roles: [UNPUBLISHED]) {
    nodes { id name role processing }
  }
}`;

export const THEME_FILES_UPSERT = `mutation OasisThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
  themeFilesUpsert(themeId: $themeId, files: $files) {
    upsertedThemeFiles { filename }
    userErrors { field message }
  }
}`;

export const PAGE_CREATE = `mutation OasisPageCreate($page: PageCreateInput!) {
  pageCreate(page: $page) {
    page { id title handle templateSuffix isPublished }
    userErrors { code field message }
  }
}`;

// Read only: the page at an address, to tell whether it is the one this payload would create.
export const PAGE_BY_HANDLE = `query OasisPageByHandle($q: String!) {
  pages(first: 5, query: $q) { nodes { id title handle isPublished templateSuffix } }
}`;

const themesResponse = z.object({
  themes: z.object({ nodes: z.array(z.object({ id: z.string(), name: z.string(), role: z.string(), processing: z.boolean().optional() })) }),
});
const upsertResponse = z.object({ themeFilesUpsert: z.object({ upsertedThemeFiles: z.array(z.object({ filename: z.string() })).nullable() }) });
const pageResponse = z.object({
  pageCreate: z.object({ page: z.object({ id: z.string(), handle: z.string(), isPublished: z.boolean().optional() }).nullable() }),
});

export interface ThemeNode {
  id: string;
  name: string;
  role: string;
  processing?: boolean;
}

// The theme to write into: an unpublished one, the first named like a copy ("Copy of ..."), else the first unpublished one.
// Never the live theme: the query asks for UNPUBLISHED only, and this checks the role again.
export function pickTheme(nodes: ThemeNode[]): ThemeNode {
  const open = nodes.filter((t) => t.role === "UNPUBLISHED" && !t.processing);
  const pick = open.find((t) => /copy/i.test(t.name)) ?? open[0];
  if (!pick) {
    throw new AppError(
      "INVALID_INPUT",
      "This store has no unpublished theme to write to. In the Shopify admin, open Online Store, Themes, and duplicate the live theme first; then ask for the page again.",
    );
  }
  return pick;
}

const THEME_PLACEHOLDER = "(the id of the unpublished theme found by the first query)";

export const filesInput = (payload: LandingPayload) => payload.files.map((f) => ({ filename: f.path, body: { type: "TEXT", value: f.content } }));
export const pageInput = (payload: LandingPayload) => ({ title: payload.title, handle: pageHandle(payload.slug), body: "", isPublished: false, templateSuffix: templateSuffix(payload.slug) });

// Pure and offline: the Admin GraphQL this payload would send. The theme id is only known once the first query has run.
export function landingMutations(payload: LandingPayload) {
  return [
    { name: "themes", query: THEMES_QUERY, variables: {} },
    { name: "themeFilesUpsert", query: THEME_FILES_UPSERT, variables: { themeId: THEME_PLACEHOLDER, files: filesInput(payload) } },
    { name: "pageCreate", query: PAGE_CREATE, variables: { page: pageInput(payload) } },
  ];
}

const pagesResponse = z.object({
  pages: z.object({ nodes: z.array(z.object({ id: z.string(), handle: z.string(), isPublished: z.boolean().optional(), templateSuffix: z.string().nullable().optional() })) }),
});

export interface CreatedPage {
  id: string;
  handle: string;
  isPublished: boolean;
  existed: boolean; // true when the page was already in the store and was read back, not created now
}

const HANDLE_TAKEN = /handle has already been taken/i;

// Creates the hidden page. If Shopify says the address is taken and the page there already uses this payload's template (an earlier
// attempt or the hand-finish script made it), that page is the result: the job is done, so a retry does not end as a failure. A page
// at that address with another template, or none, is somebody else's and the refusal stands. Any other refusal passes through.
export async function createPage(graphql: ExecEnv["graphql"], payload: LandingPayload): Promise<CreatedPage> {
  let raw: unknown;
  try {
    raw = await graphql(PAGE_CREATE, { page: pageInput(payload) });
  } catch (e) {
    if (!(e instanceof AppError) || !HANDLE_TAKEN.test(e.message)) throw e;
    const handle = pageHandle(payload.slug);
    const found = pagesResponse.parse(await graphql(PAGE_BY_HANDLE, { q: `handle:${handle}` }));
    const same = found.pages.nodes.find((p) => p.handle === handle && p.templateSuffix === templateSuffix(payload.slug));
    if (!same) throw e;
    return { id: same.id, handle: same.handle, isPublished: same.isPublished ?? false, existed: true };
  }
  const page = pageResponse.parse(raw).pageCreate.page;
  if (!page) throw new AppError("SHOPIFY_UNAVAILABLE", "Shopify did not create the page. The theme files were written; the page can be created by hand with the template.", { retryable: true });
  return { id: page.id, handle: page.handle, isPublished: page.isPublished ?? false, existed: false };
}

const numericId = (gid: string) => gid.split("/").pop() ?? gid;

const GATED = /access denied for themefilesupsert|exemption/i;

// What an approval returns when Shopify refuses the theme write: not an error, but not written either, and the card says so.
function notWritten(payload: LandingPayload, theme: ThemeNode, shopDomain: string | undefined) {
  const only = payload.files.map((f) => `--only ${f.path}`).join(" ");
  return {
    written: false,
    reason: "Shopify lets an app write theme files only after an exemption request, and this app does not have one yet. Nothing was written and no page was created.",
    themeId: theme.id,
    themeName: theme.name,
    files: payload.files.map((f) => f.path),
    finishByHand: `Save the two files shown on this card into a theme folder, then run: shopify theme push --store ${shopDomain ?? "<store>.myshopify.com"} --theme ${numericId(theme.id)} ${only}`,
  };
}

export const landingPageExecutor: Executor<LandingPayload> = {
  kind: LANDING_KIND,
  schema: landingPayloadSchema,

  async diff(payload, ctx, db): Promise<ActionDiff> {
    // The same checks as when the draft was made, so a changed catalogue or a changed file fails here and not in Shopify.
    const known = await activeProducts(db, ctx.tenantId, payload.handles);
    const missing = payload.handles.filter((h) => !known.some((p) => p.handle === h));
    if (missing.length > 0) throw new AppError("INVALID_INPUT", `These handles are not active products in this store: ${missing.join(", ")}.`);
    const campaign = payload.campaignId ? await campaignById(db, ctx.tenantId, payload.campaignId) : undefined;
    const check = await validateLanding(payload.files, { handles: new Set(known.map((p) => p.handle)), allowedNumbers: campaignNumbers(campaign ?? undefined) });
    if (!check.ok) throw new AppError("INVALID_INPUT", `The landing page failed its checks: ${check.problems.join(" ")}`);
    return {
      summary: `Add the "${payload.title}" page to the unpublished copy of the theme, with a hidden page that uses it. Nothing goes live until a person publishes it in the Shopify admin.`,
      rows: [
        { label: "Section file", after: payload.files.find((f) => f.path.startsWith("sections/"))?.path ?? "" },
        { label: "Page template", after: payload.files.find((f) => f.path.startsWith("templates/"))?.path ?? "" },
        { label: "Page", before: "(none)", after: `/pages/${pageHandle(payload.slug)}, hidden` },
        { label: "Products shown", after: payload.handles.join(", ") },
      ],
      mutations: landingMutations(payload),
      files: payload.files,
      notes: check.notes,
    };
  },

  mutations: landingMutations,

  async run(payload, env) {
    const found = themesResponse.parse(await env.graphql(THEMES_QUERY, {}));
    const theme = pickTheme(found.themes.nodes);

    let upsertRaw: unknown;
    try {
      upsertRaw = await env.graphql(THEME_FILES_UPSERT, { themeId: theme.id, files: filesInput(payload) });
    } catch (e) {
      // Shopify lets an app write theme files only after an exemption request. Without it nothing is written and no page is
      // created (it would point at a template that doesn't exist); the result says so and gives the command that finishes it.
      if (e instanceof AppError && GATED.test(e.message)) return notWritten(payload, theme, env.ctx.shop?.domain);
      throw e;
    }
    const upsert = upsertResponse.parse(upsertRaw);
    const written = upsert.themeFilesUpsert.upsertedThemeFiles?.map((f) => f.filename) ?? [];
    if (payload.files.some((f) => !written.includes(f.path))) {
      throw new AppError("SHOPIFY_UNAVAILABLE", "Shopify did not confirm that both theme files were written. Nothing was published.", { retryable: true });
    }

    const page = await createPage(env.graphql, payload);

    const store = env.ctx.shop?.domain.replace(/\.myshopify\.com$/, "");
    return {
      themeId: theme.id,
      themeName: theme.name,
      pageId: page.id,
      handle: page.handle,
      published: page.isPublished,
      ...(page.existed ? { pageExisted: true } : {}),
      files: written,
      editorUrlHint: store ? `https://admin.shopify.com/store/${store}/themes/${numericId(theme.id)}/editor?previewPath=${encodeURIComponent(`/pages/${page.handle}`)}` : null,
    };
  },
};
