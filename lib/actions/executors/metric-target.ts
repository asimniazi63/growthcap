import { z } from "zod";
import { AppError } from "../../errors";
import { monthEnd, monthStart } from "../../metrics/dates";
import { formatValue, monthName } from "../../pace/format";
import { loadPlan } from "../../pace/gap";
import type { Executor } from "../types";
import { writeResult } from "./user-errors";

// A Shopify Metric Target (analyticsTargetCreate, scope write_reports). Verified against the 2026-10 Admin GraphQL docs:
// input { metric: String!, name: String!, expectedValue: Decimal! (> 0), startDate: Date!, endDate: Date!, filters: String }.
// The target is a fixed amount for a date range in the shop's currency; only total sales and orders are written, because
// those are the two metric ids the docs show. Any other metric would need a check on the dev store first.
export const TARGET_METRICS = ["net_sales", "orders"] as const;
const SHOPIFY_METRIC = { net_sales: "total_sales", orders: "orders" } as const;
const LABEL = { net_sales: "Total sales", orders: "Orders" } as const;

export const metricTargetPayload = z.strictObject({
  metric: z.enum(TARGET_METRICS),
  month: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, "a month as YYYY-MM"),
  value: z.number().int().positive().max(100_000_000_000), // cents for net_sales, a count for orders
});
export type MetricTargetPayload = z.infer<typeof metricTargetPayload>;

const QUERY = `mutation AnalyticsTargetCreate($input: AnalyticsTargetCreateInput!) {
  analyticsTargetCreate(input: $input) {
    analyticsTarget { id metric name startDate endDate expectedValue currencyCode }
    userErrors { field message code }
  }
}`;

// Decimal goes over the wire as a string. Cents become dollars with integer maths, so there is no float error.
const expectedValue = (p: MetricTargetPayload) =>
  p.metric === "net_sales" ? `${Math.floor(p.value / 100)}.${String(p.value % 100).padStart(2, "0")}` : String(p.value);

function mutations(p: MetricTargetPayload) {
  return [
    {
      name: "analyticsTargetCreate",
      query: QUERY,
      variables: {
        input: {
          metric: SHOPIFY_METRIC[p.metric],
          name: `Oasis plan: ${LABEL[p.metric]}, ${monthName(p.month)}`,
          expectedValue: expectedValue(p),
          startDate: monthStart(p.month),
          endDate: monthEnd(p.month),
        },
      },
    },
  ];
}

export const metricTargetExecutor: Executor<MetricTargetPayload> = {
  kind: "metric_target",
  schema: metricTargetPayload,
  mutations,
  async diff(p, ctx, db) {
    const currency = ctx.shop?.currency ?? "USD";
    const plan = await loadPlan(db, ctx.tenantId);
    const current = plan?.targets.get(p.month)?.[p.metric];
    const month = monthName(p.month);
    return {
      summary: `Set a ${LABEL[p.metric].toLowerCase()} target of ${formatValue(p.metric, p.value, currency)} for ${month} in the store's Shopify analytics.`,
      rows: [
        {
          label: `${LABEL[p.metric]} target, ${month}`,
          before: current === undefined ? "No target in the plan" : `${formatValue(p.metric, current, currency)} (current plan)`,
          after: formatValue(p.metric, p.value, currency),
        },
      ],
      notes: [
        "Shopify tracks this against its own Total sales and Orders figures. The Oasis plan is not changed by this action.",
        "Shopify refuses a second target for the same metric and dates.",
      ],
    };
  },
  async run(p, env) {
    const [m] = mutations(p);
    const out = writeResult(await env.graphql(m!.query, m!.variables), "analyticsTargetCreate");
    const target = out.analyticsTarget as { id?: string } | null;
    if (!target?.id) throw new AppError("INTERNAL_ERROR", "Shopify created no target");
    return { target };
  },
};
