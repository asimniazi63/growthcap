import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { z } from "zod";
import { proposeAction as ledgerPropose } from "../actions/ledger";
import type { ActionView, ProposeInput } from "../actions/types";
import type { ExtraToolDeps } from "../agent/extra-types";
import { localDate } from "../clock";
import { AppError } from "../errors";
import { addDays } from "../metrics/dates";
import { buildLandingFiles, campaignNumbers } from "./build";
import { activeProducts, findCampaign, sampleHandles } from "./data";
import { LANDING_KIND, handleSchema, landingCopySchema, type LandingPayload } from "./types";
import { lintCopy, validateLanding } from "./validate";

// draft_landing_page: the model writes words, the server builds and checks the Liquid, and the result is an approval card.
// The tool never calls Shopify. It only proposes; the write happens in the executor after a person approves.

export const draftLandingPageInput = z.strictObject({
  campaignId: z.string().trim().min(1).max(120).optional().describe("A planned campaign from the calendar: its id, or its exact title. Give this or productHandle."),
  productHandle: handleSchema.optional().describe("A product the page is about (for example the one being restocked), from search_products. Give this or campaignId."),
  headline: landingCopySchema.shape.headline.describe("At most 80 characters. Plain words: no HTML, no prices, no links."),
  subhead: landingCopySchema.shape.subhead.describe("At most 160 characters."),
  bullets: landingCopySchema.shape.bullets.describe("2 to 5 short selling points, at most 120 characters each. No prices."),
  ctaLabel: landingCopySchema.shape.ctaLabel.describe("The button label, at most 30 characters."),
  productHandles: landingCopySchema.shape.productHandles.describe("1 to 6 handles of active products to show, taken from search_products results."),
});
export type DraftLandingPageInput = z.infer<typeof draftLandingPageInput>;

type Propose = (db: ExtraToolDeps["db"], ctx: ExtraToolDeps["ctx"], input: ProposeInput) => Promise<ActionView>;

const recoverable = (e: unknown) => e instanceof AppError && e.code === "INVALID_INPUT";
const MAX_FAILURES = 4;

export function buildDraftLandingPageTool(d: ExtraToolDeps, propose: Propose = ledgerPropose) {
  let proposed = 0;
  let failures = 0;
  return tool({
    description:
      "Draft a landing page for a planned campaign (from the calendar) or for a product, when the user asks for one. You write words only: headline, subhead, bullets and a button label. Never write Liquid, HTML, prices, discounts, links, percentages or any digits at all (no years either, unless the campaign has them); the server builds the page and checks it, and prices and stock are read live from the store. Take productHandles from search_products results. This does not publish anything: it puts an approval card in the answer with the code and the check result; when a Growth Capital admin or partner approves, the page is written to the unpublished copy of the theme as a hidden page, and a person publishes it in the Shopify admin. After calling it, say the draft is waiting for approval. If it returns an error, fix the copy it names and call once more.",
    inputSchema: draftLandingPageInput,
    execute: async (input) => {
      const started = Date.now();
      try {
        if (proposed >= 1) throw new AppError("INVALID_INPUT", "One landing page can be drafted in an answer.");
        if (failures >= MAX_FAILURES) throw new AppError("INVALID_INPUT", "The draft failed its checks several times. Do not try again; tell the user what was wrong.");
        if (Boolean(input.campaignId) === Boolean(input.productHandle)) throw new AppError("INVALID_INPUT", "Give either campaignId or productHandle, one of them.");

        const campaign = input.campaignId ? await findCampaign(d.db, d.ctx.tenantId, input.campaignId) : undefined;
        const handles = [...new Set([...(input.productHandle ? [input.productHandle] : []), ...input.productHandles])].slice(0, 6);
        const found = await activeProducts(d.db, d.ctx.tenantId, handles);
        const missing = handles.filter((h) => !found.some((p) => p.handle === h));
        if (missing.length > 0) {
          const valid = await sampleHandles(d.db, d.ctx.tenantId);
          throw new AppError("INVALID_INPUT", `These handles are not active products in this store: ${missing.join(", ")}. A handle is the lowercase, hyphenated name in search_products results. Some that exist: ${valid.join(", ")}.`);
        }

        const copy = { headline: input.headline, subhead: input.subhead, bullets: input.bullets, ctaLabel: input.ctaLabel, productHandles: handles };
        const allowedNumbers = campaignNumbers(campaign);
        const copyProblems = lintCopy(copy, allowedNumbers);
        if (copyProblems.length > 0) throw new AppError("INVALID_INPUT", `The copy needs changes: ${copyProblems.join(" ")}`);

        const draft = buildLandingFiles(copy, found, campaign);
        const check = await validateLanding(draft.files, { handles: new Set(found.map((p) => p.handle)), allowedNumbers });
        if (!check.ok) throw new AppError("INVALID_INPUT", `The draft failed its checks: ${check.problems.join(" ")} Change the copy and call again.`);

        const today = localDate(d.now.getTime(), d.ctx.shop?.timezone ?? "UTC");
        const checkOn = campaign && campaign.dateTo >= today ? campaign.dateTo : addDays(today, 7);
        const subject = campaign ? campaign.title : (found.find((p) => p.handle === handles[0])?.title ?? handles[0]!);
        const payload: LandingPayload = { files: draft.files, slug: draft.slug, title: draft.title, handles, ...(campaign?.id ? { campaignId: campaign.id } : {}) };
        const view = await propose(d.db, d.ctx, {
          kind: LANDING_KIND,
          title: draft.title,
          payload,
          hypothesis: campaign
            ? `A page made for ${subject} gives its traffic one place to land with live prices and stock, which should lift net sales while it runs.`
            : `A page made for ${subject} gives its traffic one place to land with live prices and stock, which should lift net sales for it.`,
          metric: "net_sales",
          checkOn,
        });
        proposed++;
        d.write({ type: "data-action", data: view } as UIMessageChunk);
        d.onStep({ tool: "draft_landing_page", input, ok: true, latencyMs: Date.now() - started });
        // Nothing here to misquote: no amounts, no dates, no outcome. The card shows the code and the checks.
        return { proposed: true, actionId: view.id, needsApproval: true, checks: (view.diff.notes ?? []).filter((n) => !/\d/.test(n)) };
      } catch (e) {
        d.onStep({ tool: "draft_landing_page", input, ok: false, errorCode: e instanceof AppError ? e.code : "INTERNAL_ERROR", latencyMs: Date.now() - started });
        if (recoverable(e)) {
          failures++;
          return { error: { code: (e as AppError).code, message: (e as AppError).message } };
        }
        throw e;
      }
    },
  });
}
