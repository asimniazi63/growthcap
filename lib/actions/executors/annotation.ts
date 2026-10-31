import { z } from "zod";
import { AppError } from "../../errors";
import { isValidDate } from "../../metrics/dates";
import { formatRange } from "../../pace/format";
import type { Executor } from "../types";
import { writeResult } from "./user-errors";

// A chart annotation in Shopify analytics (analyticsAnnotationCreate, scope write_analytics_annotations). Verified against the
// 2026-10 Admin GraphQL docs: input { type: String!, title: String! (max 75), startedAt: DateTime!, endedAt: DateTime,
// description: String (max 150) }. type "other" is the custom_events type that the ShopifyQL annotate docs list as creatable
// through the Admin API. Leaving endedAt out makes it a point in time. An app has a limit of annotations per shop (LIMIT_REACHED).
export const annotationPayload = z.strictObject({
  date: z.string().refine(isValidDate, "a date as YYYY-MM-DD"),
  title: z.string().trim().min(1).max(75), // Shopify's limit is 75, below the 80 asked for in the brief
  text: z.string().trim().min(1).max(150), // Shopify's limit is 150
});
export type AnnotationPayload = z.infer<typeof annotationPayload>;

const QUERY = `mutation AnalyticsAnnotationCreate($input: AnalyticsAnnotationCreateInput!) {
  analyticsAnnotationCreate(input: $input) {
    analyticsAnnotation { id type title startedAt description }
    userErrors { field message code }
  }
}`;

function mutations(p: AnnotationPayload) {
  return [
    {
      name: "analyticsAnnotationCreate",
      query: QUERY,
      // Noon UTC, so the marker lands on this calendar day in every store timezone from UTC-12 to UTC+11.
      variables: { input: { type: "other", title: p.title, description: p.text, startedAt: `${p.date}T12:00:00Z` } },
    },
  ];
}

export const annotationExecutor: Executor<AnnotationPayload> = {
  kind: "annotation",
  schema: annotationPayload,
  mutations,
  async diff(p) {
    return {
      summary: `Add a note to the store's Shopify analytics charts on ${formatRange(p.date, p.date)}.`,
      rows: [
        { label: "Date", after: formatRange(p.date, p.date) },
        { label: "Title", after: p.title },
        { label: "Note", after: p.text },
      ],
    };
  },
  async run(p, env) {
    const [m] = mutations(p);
    const out = writeResult(await env.graphql(m!.query, m!.variables), "analyticsAnnotationCreate");
    const annotation = out.analyticsAnnotation as { id?: string } | null;
    if (!annotation?.id) throw new AppError("INTERNAL_ERROR", "Shopify created no annotation");
    return { annotation };
  },
};
