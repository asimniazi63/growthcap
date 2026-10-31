import { z } from "zod";

// The landing page feature (T9). The model writes copy only; the server builds the Liquid from fixed templates.

export const LANDING_KIND = "landing_page" as const;

export const handleSchema = z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "a product handle is lowercase letters, digits and dashes");

// What the model may write. No Liquid, no HTML, no prices: those are rejected or come from the store's own objects.
export const landingCopySchema = z.strictObject({
  headline: z.string().trim().min(1).max(80),
  subhead: z.string().trim().min(1).max(160),
  bullets: z.array(z.string().trim().min(1).max(120)).min(2).max(5),
  ctaLabel: z.string().trim().min(1).max(30),
  productHandles: z.array(handleSchema).min(1).max(6),
});
export type LandingCopy = z.infer<typeof landingCopySchema>;

export interface LandingProduct {
  handle: string;
  title: string; // store text: untrusted, used only as a page title
}

// A calendar_events row. Every text field is untrusted: it is escaped before it goes into a file.
export interface LandingCampaign {
  id?: string;
  title: string;
  dateFrom: string;
  dateTo: string;
  channel?: string;
  details?: string;
}

export interface LandingFile {
  path: string;
  content: string;
}

export const slugSchema = z.string().min(1).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const sectionPath = (slug: string) => `sections/oasis-landing-${slug}.liquid`;
export const templatePath = (slug: string) => `templates/page.oasis-landing-${slug}.json`;
export const templateSuffix = (slug: string) => `oasis-landing-${slug}`;
export const pageHandle = (slug: string) => `oasis-${slug}`;

// What the ledger stores and the executor runs. The two paths are pinned to the slug, so a payload can write nothing else.
export const landingPayloadSchema = z
  .strictObject({
    files: z.array(z.strictObject({ path: z.string().max(120), content: z.string().min(1).max(40_000) })).length(2),
    slug: slugSchema,
    title: z.string().trim().min(1).max(120),
    handles: z.array(handleSchema).min(1).max(6),
    campaignId: z.uuid().optional(),
  })
  .superRefine((p, ctx) => {
    const want = [sectionPath(p.slug), templatePath(p.slug)];
    if (!want.every((path) => p.files.some((f) => f.path === path))) {
      ctx.addIssue({ code: "custom", message: `The files must be exactly ${want.join(" and ")}.`, path: ["files"] });
    }
  });
export type LandingPayload = z.infer<typeof landingPayloadSchema>;
