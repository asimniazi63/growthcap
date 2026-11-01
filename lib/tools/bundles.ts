import { z } from "zod";
import type { Db } from "../db/client";
import { loadBaskets, loadProductTitles, pairStatsOf, type PairStat } from "../metrics/merchandising";
import type { TenantContext } from "../tenancy/context";
import { assertInWindow, asOfOf, capLimit, dbFor, idList, limitField, loadWindow, parseInput, periodShape, queryIdFor, resolveRange, todayFor, type Ctx } from "./common";
import { requireConnectedShop, type ToolResult } from "./result";

const DEFAULT_MIN_ORDERS = 5;

// strictObject: an unknown key (a tenant, a shop, anything the model invents) is an error, not ignored.
export const getBundleCandidatesInputSchema = z.strictObject({
  ...periodShape, // the orders to look at; default the whole data window, because pairs need volume
  minOrders: z.number().int().min(2).max(100).optional(), // a pair must appear together in at least this many orders; default 5
  productIds: idList.optional(), // only pairs that include one of these products
  limit: limitField,
});
export type GetBundleCandidatesInput = z.input<typeof getBundleCandidatesInputSchema>;

export interface BundlePairRow extends PairStat {
  untrusted: { productA: string; productB: string }; // store text: the product titles
}

export interface BundleCandidatesData {
  ordersInRange: number; // every order of the range: the denominator of support, orders with a single product included
  ordersWithTwoOrMoreProducts: number;
  pairs: BundlePairRow[];
  caveats?: string[];
}

const DEFINITIONS = {
  pairs:
    "Product pairs, not variants: every variant of a product counts as that product. An order counts for a pair when it holds both products, whatever the quantities; cancelled orders are left out. A pair is listed when it appears together in at least minOrders orders. This is co-purchase association within one order, not proof that people want a bundle or that a bundle would sell: a pair can sit together because both are popular, because a gift set or a promotion put them there, or by chance. Rows are sorted by lift, highest first, then by ordersTogether, so a pair seen only a few times can rank high: read ordersTogether with lift.",
  support:
    "ordersTogether divided by ordersInRange, a fraction. The denominator is every order in the range, including orders with a single product (and orders with none), so support is small whenever most orders are single-product ones.",
  confidence:
    "confidenceAtoB is the share of the orders that contain product A that also contain product B (ordersTogether divided by ordersA); confidenceBtoA is the reverse (divided by ordersB). They differ: a niche product is often bought with a popular one while the popular one is rarely bought with it.",
  lift:
    "support divided by (the share of orders containing A times the share of orders containing B), a plain ratio and not a percentage. Around 1 means the pair appears together about as often as two unrelated products bought independently would; above 1, more often; below 1, less often. It says nothing about why.",
};

// Products often bought together, from the orders of a range. The tenant is the session's; every figure is computed here.
export async function getBundleCandidates(ctx: Ctx, rawInput: GetBundleCandidatesInput, deps: { db?: Db } = {}): Promise<ToolResult<BundleCandidatesData>> {
  const shop = requireConnectedShop(ctx);
  const input = parseInput(getBundleCandidatesInputSchema, rawInput);
  const db = await dbFor(deps);
  const win = await loadWindow(db, ctx.tenantId);
  const hasRange = input.period !== undefined || input.from !== undefined || input.to !== undefined;
  const requested = hasRange ? resolveRange(input, todayFor(shop.timezone, win)) : { from: win.first ?? "", to: win.last ?? "" };
  assertInWindow(requested, win);
  const range = { from: requested.from, to: requested.to > win.last! ? win.last! : requested.to };
  const minOrders = input.minOrders ?? DEFAULT_MIN_ORDERS;

  const baskets = await loadBaskets(db, ctx.tenantId, range);
  const stats = pairStatsOf(baskets, { minOrders, ...(input.productIds ? { productIds: input.productIds } : {}) });
  const total = stats.pairs.length;
  const shown = stats.pairs.slice(0, capLimit(input.limit));
  const titles = await loadProductTitles(db, ctx.tenantId, [...new Set(shown.flatMap((p) => [p.productAId, p.productBId]))]);
  const title = (id: string) => titles.get(id) ?? "(a product no longer in the catalogue)";

  const caveats: string[] = [];
  if (total === 0) {
    if (stats.ordersWithTwoOrMoreProducts === 0) caveats.push("No order in this range has two different products, so there are no pairs.");
    else caveats.push(`No pair of products appeared together in at least ${minOrders} orders in this range${input.productIds ? " among the products asked for" : ""}, so none is listed.`);
  }

  const asOf = asOfOf(win);
  return {
    data: {
      ordersInRange: stats.ordersInRange,
      ordersWithTwoOrMoreProducts: stats.ordersWithTwoOrMoreProducts,
      pairs: shown.map((p) => ({ ...p, untrusted: { productA: title(p.productAId), productB: title(p.productBId) } })),
      ...(caveats.length > 0 ? { caveats } : {}),
    },
    queryId: queryIdFor("get_bundle_candidates", ctx.tenantId, input, asOf),
    range,
    definitions: DEFINITIONS,
    asOf,
    ...(total > shown.length ? { truncated: { shown: shown.length, total } } : {}),
  };
}

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

// The shape of an entry of TOOL_DEFS in lib/agent/tools.ts.
export const getBundleCandidatesTool = {
  description:
    "Products often bought together, as bundle candidates. Counts, per pair of products (variants collapse into their product; quantities ignored; cancelled orders left out), the orders that hold both. Defaults to the whole data window because pairs need volume; give period or from and to to narrow it. A pair is listed when it appears together in at least minOrders orders (2 to 100, default 5); productIds keeps only pairs that include one of those products. Rows are sorted by lift, highest first: ordersTogether, ordersA and ordersB are order counts; support is ordersTogether as a fraction of ALL orders (ordersInRange, single-product orders included); confidenceAtoB is the share of orders with the first product that also had the second, confidenceBtoA the reverse; lift is a plain ratio (1.9 means 1.9 times as often as chance), not a percentage. Product titles are under untrusted. A high lift on a few orders is weak: always give ordersTogether beside it. Say it is co-purchase association, not proof that people want a bundle, and read caveats and truncated. Quote every figure as written; never work out a share, a ratio or a difference yourself.",
  schema: getBundleCandidatesInputSchema as z.ZodType,
  run: getBundleCandidates as unknown as Run,
};
