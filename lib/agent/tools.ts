import { tool, type ToolSet } from "ai";
import type { z } from "zod";
import type { Db } from "../db/client";
import { getActionItemsTool } from "../action-items/tool";
import { runGrowthAuditTool } from "../audit/tool";
import { AppError } from "../errors";
import { getDataHealthTool } from "../health/tool";
import { askDocumentTool } from "../plan-in/ask-tool";
import { getCohortsTool } from "../tools/cohorts";
import { getUnitEconomicsTool } from "../tools/unit-economics";
import { getZeroSalesDaysTool } from "../tools/zero-sales-days";
import { queryMetric, queryMetricInputSchema } from "../metrics/query";
import type { TenantContext } from "../tenancy/context";
import { getCustomers, getCustomersInputSchema } from "../tools/customers";
import { describeMetrics, describeMetricsInputSchema } from "../tools/describe";
import { getInventory, getInventoryInputSchema } from "../tools/inventory";
import { getOrders, getOrdersInputSchema } from "../tools/orders";
import { searchProducts, searchProductsInputSchema } from "../tools/products";
import type { ToolResult } from "../tools/result";

// The six tools, bound to the signed-in tenant. The tenant lives in this closure and in nothing the model can write:
// no schema has a tenant, shop or org field, and unknown keys are rejected.

type Run = (ctx: TenantContext, input: never, deps: { db?: Db }) => Promise<ToolResult<unknown>>;

interface ToolDef {
  description: string;
  schema: z.ZodType;
  run: Run;
}

export const TOOL_DEFS: Record<string, ToolDef> = {
  query_metric: {
    description:
      "Totals, trends, breakdowns and period comparisons for the store's sales. Metrics: gross_sales, discounts, refunds, net_sales, orders, aov, units, new_customer_orders, returning_customer_rate, refund_rate, discounted_order_share, gross_margin (uses today's unit cost; each row carries costCoverage with the variants left out for having no cost). Use period (last_7_days, last_30_days, this_month, last_month, this_year) or from and to (store-local dates). groupBy splits by day, week, month, product, variant, channel, discount_code, customer_type or tag. filters narrow the orders: tags keeps ONLY orders carrying a tag, excludeTags drops them (for 'with and without wholesale' run once with no filters and once with excludeTags). With no period the last 30 days are used. When the range is part or all of one month and nothing is grouped or filtered, the row also carries gapToPlan against the brand's plan: target, planned so far, actual, gap, pctGap and, for a month to date, projected (an estimate of where the month will land) and neededPerDay with daysLeft (what each remaining day must bring to hit the target; targetMet is true when it is already met), with spread saying how the target was spread over the days. compareTo gives the previous period or year with change and percent change. Results carry change, percent change and share so you never compute them.",
    schema: queryMetricInputSchema,
    run: queryMetric as unknown as Run,
  },
  get_orders: {
    description:
      "Find or list orders by date, discount code, channel, tag, product, variant, customer id, new or returning customer, or whether they were refunded. Give orderNumbers (for example 1982 for order #1982) or orderIds with one order for that order's lines and refunds, with no dates needed; add includeNote only when the user asks for the note. Shows the newest 50 by default and says how many there are in all.",
    schema: getOrdersInputSchema,
    run: getOrders as unknown as Run,
  },
  search_products: {
    description: "Products and variants by part of the name or status, with price, unit cost and margin already worked out.",
    schema: searchProductsInputSchema,
    run: searchProducts as unknown as Run,
  },
  get_inventory: {
    description:
      "Stock per variant and location, with days of cover at the recent sales rate (units sold in the window divided by its days). Lists the variants that will run out first. Variants with no sales in the window have no days of cover.",
    schema: getInventoryInputSchema,
    run: getInventory as unknown as Run,
  },
  get_customers: {
    description:
      "Customer counts for a period (active, new, returning), or the top customers by spend or orders. Customers are pseudonymous ids only. Use view summary or list.",
    schema: getCustomersInputSchema,
    run: getCustomers as unknown as Run,
  },
  ask_document: askDocumentTool as unknown as ToolDef,
  get_cohorts: getCohortsTool as unknown as ToolDef,
  get_unit_economics: getUnitEconomicsTool as unknown as ToolDef,
  get_zero_sales_days: getZeroSalesDaysTool as unknown as ToolDef,
  get_action_items: getActionItemsTool as unknown as ToolDef,
  get_data_health: getDataHealthTool as unknown as ToolDef,
  run_growth_audit: runGrowthAuditTool as unknown as ToolDef,
  describe_metrics: {
    description: "What each metric means, the groupings and periods the tools accept, and how money and rates are written. Use it when the user asks what a metric is.",
    schema: describeMetricsInputSchema,
    run: describeMetrics as unknown as Run,
  },
};

// The model can recover from these (fix the input, or tell the user there is no data). Anything else ends the turn
// with its own error, as a disconnected store must.
const RECOVERABLE = new Set(["INVALID_INPUT", "NO_DATA"]);

export interface ToolHooks {
  onSuccess?: (e: { tool: string; input: unknown; result: ToolResult<unknown>; latencyMs: number }) => void;
  onFailure?: (e: { tool: string; input: unknown; error: unknown; latencyMs: number }) => void;
  onFatal?: (error: unknown) => void;
}

// Tools for Growth Capital roles only. A client viewer's agent is never given them (each also refuses a viewer when run).
const GC_ONLY_TOOLS = new Set(["get_action_items", "run_growth_audit", "ask_document"]);

export function buildTools(ctx: TenantContext, hooks: ToolHooks = {}, deps: { db?: Db } = {}): ToolSet {
  return Object.fromEntries(
    Object.entries(TOOL_DEFS)
      .filter(([name]) => !(GC_ONLY_TOOLS.has(name) && ctx.role === "client_viewer"))
      .map(([name, def]) => [
      name,
      tool({
        description: def.description,
        inputSchema: def.schema,
        execute: async (input: unknown) => {
          const started = Date.now();
          try {
            const result = await def.run(ctx, input as never, deps);
            hooks.onSuccess?.({ tool: name, input, result, latencyMs: Date.now() - started });
            return result;
          } catch (error) {
            hooks.onFailure?.({ tool: name, input, error, latencyMs: Date.now() - started });
            if (error instanceof AppError && RECOVERABLE.has(error.code)) return { error: { code: error.code, message: error.message } };
            hooks.onFatal?.(error);
            throw error;
          }
        },
      }),
    ]),
  );
}
