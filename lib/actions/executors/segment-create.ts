import { z } from "zod";
import type { Db } from "../../db/client";
import { AppError } from "../../errors";
import { loadSegmentCustomers, summarizeSegments } from "../../metrics/segments";
import { SEGMENT_IDS, SEGMENTS, type SegmentId } from "../../segments/definitions";
import { shopifySegmentCaveat, shopifySegmentQuery } from "../../segments/shopify-query";
import type { Executor } from "../types";
import { writeResult } from "./user-errors";

// Saves one of our four customer segments in Shopify as a customer segment (segmentCreate(name: String!, query: String!)),
// checked against the 2026-10 Admin GraphQL docs. It returns { segment, userErrors { field message } }, segment names must be
// unique, and it needs the write_customers scope (the user must not have restricted access). It stores a filter only: no customer
// is emailed, tagged or changed. The Shopify query is NEVER part of the payload or anything the model writes: it comes only from
// shopifySegmentQuery(payload.segment), which is built from the segment rules, so an approval can only ever create one of the four.
export const SEGMENT_NAME_MAX = 80;

export const segmentCreatePayload = z.strictObject({
  segment: z.enum(SEGMENT_IDS),
  name: z
    .string()
    .trim()
    .min(1)
    .max(SEGMENT_NAME_MAX)
    .regex(/^[\p{L}\p{N} '&()-]+$/u, "letters, digits, spaces and - & ' ( ) only"),
});
export type SegmentCreatePayload = z.infer<typeof segmentCreatePayload>;

const CREATE = `mutation SegmentCreate($name: String!, $query: String!) {
  segmentCreate(name: $name, query: $query) {
    segment { id name query }
    userErrors { field message }
  }
}`;

export const NO_SCOPE_MESSAGE = "Shopify refused: this app does not have permission to create customer segments yet. Ask Asim to add the scope and redeploy the app.";
// What Shopify says when the app lacks the scope (top-level ACCESS_DENIED: "Access denied for segmentCreate field. Required access:
// `write_customers` access scope. ..."), or answers a bare 403.
const NO_SCOPE = /access denied|required access|access scope|write_customers|HTTP 403/i;
const NAME_TAKEN = /already (been )?taken|must be unique|already exists/i;

function mutations(p: SegmentCreatePayload) {
  return [{ name: "segmentCreate", query: CREATE, variables: { name: p.name, query: shopifySegmentQuery(p.segment) } }];
}

// How many of our customers the segment holds today, from the synced orders. Information for the approver, so a failure to work it
// out is shown as such and does not stop the proposal.
async function ourCount(db: Db, tenantId: string, segment: SegmentId): Promise<string> {
  try {
    const { asOf, customers } = await loadSegmentCustomers(db, tenantId);
    if (!asOf) return "Not available: no orders are synced yet";
    const n = summarizeSegments(customers).find((s) => s.segment === segment)?.customers ?? 0;
    return `${n.toLocaleString("en-US")} ${n === 1 ? "customer" : "customers"}, from the orders synced up to ${asOf}`;
  } catch (e) {
    console.error("[actions] segment_create could not count the segment:", e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200));
    return "Not available: the count could not be worked out";
  }
}

export const segmentCreateExecutor: Executor<SegmentCreatePayload> = {
  kind: "segment_create",
  schema: segmentCreatePayload,
  mutations,
  async diff(p, ctx, db) {
    const info = SEGMENTS.find((s) => s.id === p.segment)!;
    const caveat = shopifySegmentCaveat(p.segment);
    return {
      summary: `Create a customer segment in Shopify named ${p.name}. It only saves a filter; no customer is emailed or changed.`,
      rows: [
        { label: "Segment name", after: p.name },
        { label: "Based on", after: `${info.title}: ${info.description}` },
        { label: "Shopify query", after: shopifySegmentQuery(p.segment) },
        { label: "Our count", after: await ourCount(db, ctx.tenantId, p.segment) },
      ],
      notes: [
        "Shopify works out this segment on its own full customer list, so its count can differ from ours. Ours counts only customers with synced orders, and each customer is in one segment.",
        ...(caveat ? [caveat] : []),
        "Needs the write_customers permission for the app. If the store has not granted it, nothing is created and the card says so.",
      ],
    };
  },
  async run(p, env) {
    const [m] = mutations(p);
    let out: Record<string, unknown>;
    try {
      out = writeResult(await env.graphql(m!.query, m!.variables), "segmentCreate");
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (NO_SCOPE.test(reason)) throw new AppError("INVALID_INPUT", NO_SCOPE_MESSAGE, { cause: e });
      if (NAME_TAKEN.test(reason)) throw new AppError("INVALID_INPUT", `Shopify already has a segment named "${p.name}". Ask for it again with a different name.`, { cause: e });
      throw e;
    }
    const segment = out.segment as { id?: string; name?: string; query?: string } | null;
    if (!segment?.id) throw new AppError("INTERNAL_ERROR", "Shopify created no segment");
    return { segment };
  },
};
