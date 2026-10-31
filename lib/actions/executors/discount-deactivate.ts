import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../../errors";
import { orders } from "../../db/schema";
import type { Executor } from "../types";
import { writeResult } from "./user-errors";

// Turns a discount code off (discountCodeDeactivate(id: ID!), scope write_discounts). The id comes from the code with
// codeDiscountNodeByCode(code: String!), scope read_discounts. Both verified against the 2026-10 Admin GraphQL docs. The code
// stays in the store and can be turned on again; nothing is deleted.
export const discountDeactivatePayload = z.strictObject({
  code: z.string().regex(/^[A-Z0-9]{1,30}$/, "a discount code in capitals and digits, such as VIPGLOW25"),
});
export type DiscountDeactivatePayload = z.infer<typeof discountDeactivatePayload>;

const LOOKUP = `query CodeDiscountNodeByCode($code: String!) {
  codeDiscountNodeByCode(code: $code) { id }
}`;

const DEACTIVATE = `mutation DiscountCodeDeactivate($id: ID!) {
  discountCodeDeactivate(id: $id) {
    codeDiscountNode {
      id
      codeDiscount {
        ... on DiscountCodeBasic { status }
        ... on DiscountCodeBxgy { status }
        ... on DiscountCodeFreeShipping { status }
        ... on DiscountCodeApp { status }
      }
    }
    userErrors { field message code }
  }
}`;

// The id exists only once the lookup has run, so a dry run shows the lookup and a stand-in for its result.
const ID_FROM_LOOKUP = "(the id that codeDiscountNodeByCode returns for this code)";

function mutations(p: DiscountDeactivatePayload) {
  return [
    { name: "codeDiscountNodeByCode", query: LOOKUP, variables: { code: p.code } },
    { name: "discountCodeDeactivate", query: DEACTIVATE, variables: { id: ID_FROM_LOOKUP } },
  ];
}

export const discountDeactivateExecutor: Executor<DiscountDeactivatePayload> = {
  kind: "discount_deactivate",
  schema: discountDeactivatePayload,
  mutations,
  async diff(p, ctx, db) {
    // Only a sanity check from the synced orders: a code nobody has ever used may be a typo.
    const [row] = await db
      .select({ n: count() })
      .from(orders)
      .where(and(eq(orders.tenantId, ctx.tenantId), sql`upper(${orders.discountCode}) = ${p.code}`));
    const used = row?.n ?? 0;
    return {
      summary: `Turn off the discount code ${p.code}. It stays in the store, and customers can no longer use it at checkout.`,
      rows: [{ label: `Discount code ${p.code}`, after: "Deactivated" }],
      notes: [used > 0 ? `${p.code} appears on ${used} synced ${used === 1 ? "order" : "orders"}.` : `No synced order used ${p.code}. Check the code is right before approving.`],
    };
  },
  async run(p, env) {
    const found = await env.graphql(LOOKUP, { code: p.code });
    const node = found && typeof found === "object" ? (found as { codeDiscountNodeByCode?: { id?: string } | null }).codeDiscountNodeByCode : null;
    if (!node?.id) throw new AppError("INVALID_INPUT", `No discount code ${p.code} exists in this store.`);
    const out = writeResult(await env.graphql(DEACTIVATE, { id: node.id }), "discountCodeDeactivate");
    const deactivated = out.codeDiscountNode as { id?: string } | null;
    if (!deactivated?.id) throw new AppError("INTERNAL_ERROR", `Shopify did not confirm that ${p.code} was deactivated`);
    return { code: p.code, discount: deactivated };
  },
};
