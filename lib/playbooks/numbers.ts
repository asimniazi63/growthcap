import { localDate } from "../clock";
import type { Db } from "../db/client";
import { addDays, addMonths, monthEnd, monthOf, monthStart } from "../metrics/dates";
import type { TenantContext } from "../tenancy/context";
import { rebuild as rebuildView } from "../views/saved";
import type { ViewComponent, ViewData, ViewSourceRef } from "../views/types";
import type { PlaybookId, PlaybookParams } from "./definitions";
import { blackFridayWeekend } from "./questions";

// The live numbers above a playbook's write-up. For each playbook, two views of the figures its write-up is about, drawn by the same
// components the chat uses, from the same tools, when the page opens. A recipe holds a view component and the tool inputs behind it,
// never a number: every figure on screen comes from a tool result, as in a pinned view (lib/views/saved.ts). The write-up itself is
// unchanged: these are drawn from the data, so they are not model text and cost no model call.
//
// Every view is drawn for the period the write-up was about, worked out from the run's own date (a Black Friday weekend, a month, the 30
// days or 90 days before the run), with the same query the run's question asked for. So the figures line up with the text instead of
// moving on every visit; the data behind them is read fresh each time. The three big charts are folded behind a Show row.

export interface NumbersRun {
  playbook: PlaybookId;
  createdAt: Date;
  params: PlaybookParams;
}

export interface NumbersRecipe {
  key: string;
  title: string;
  component: ViewComponent;
  sources: ViewSourceRef[];
  wide: boolean; // takes the full width of the card; a narrow one shares a row with the next
  fold: string | null; // the label of the closed row a big chart sits behind ("Show ..."); null for one that is drawn open
}

const DAY_MS = 86_400_000;
const COUNTS_AFTER_DAYS = 181; // the Creative briefs question asks about a weekend every customer in it has had 180 days to come back from

const metric = (input: object): ViewSourceRef => ({ tool: "query_metric", input });
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function numbersRecipes(playbook: PlaybookId, run: NumbersRun, timezone: string): NumbersRecipe[] {
  switch (playbook) {
    case "bfcm-review": {
      const w = blackFridayWeekend(run.createdAt);
      return [
        {
          key: "weekend",
          title: "The weekend in numbers",
          component: "kpi",
          sources: [metric({ metrics: ["net_sales", "orders", "aov", "new_customer_orders", "discounted_order_share"], from: w.from, to: w.to, compareTo: "previous_period" })],
          wide: false,
          fold: null,
        },
        {
          key: "codes",
          title: "Orders by discount code",
          component: "bar",
          sources: [metric({ metrics: ["orders", "net_sales"], from: w.from, to: w.to, groupBy: ["discount_code"], limit: 8 })],
          wide: false,
          fold: null,
        },
      ];
    }
    case "retention-check": {
      // The question asks for the last 30 days against the 30 before, ending the day of the run in the store's time zone.
      const today = localDate(run.createdAt.getTime(), timezone);
      return [
        {
          key: "returning",
          title: "Returning customers, last 30 days",
          component: "kpi",
          sources: [metric({ metrics: ["returning_customer_rate", "new_customer_orders"], from: addDays(today, -29), to: today, compareTo: "previous_period" })],
          wide: true,
          fold: null,
        },
        {
          key: "cohorts",
          title: "Repeat rate by first-order month",
          component: "cohort",
          sources: [{ tool: "get_cohorts", input: { windowDays: 60 } }],
          wide: true,
          fold: "Show the repeat rate by first-order month",
        },
      ];
    }
    case "monthly-review": {
      const month = run.params.month ?? addMonths(monthOf(localDate(run.createdAt.getTime(), timezone)), -1);
      const range = { from: monthStart(month), to: monthEnd(month) };
      return [
        { key: "month", title: "The month in numbers", component: "kpi", sources: [metric({ metrics: ["net_sales", "orders", "aov", "new_customer_orders", "refund_rate"], ...range })], wide: true, fold: null },
        { key: "daily", title: "Net sales by day", component: "line", sources: [metric({ metrics: ["net_sales"], ...range, groupBy: ["day"] })], wide: true, fold: "Show net sales by day" },
      ];
    }
    case "creative-briefs": {
      const w = blackFridayWeekend(new Date(run.createdAt.getTime() - COUNTS_AFTER_DAYS * DAY_MS));
      // The question's own query for the best sellers: the 90 days before the day of the run (a UTC date, as the question writes it).
      const today = ymd(run.createdAt);
      return [
        {
          key: "bestSellers",
          title: "Best sellers, last 90 days",
          component: "bar",
          sources: [metric({ metrics: ["units", "net_sales"], from: addDays(today, -90), to: addDays(today, -1), groupBy: ["product"], limit: 8 })],
          wide: true,
          fold: null,
        },
        {
          key: "lastYear",
          title: "Last year's Black Friday weekend",
          component: "lift_dip",
          sources: [{ tool: "get_promo_postmortem", input: { from: w.from, to: w.to, repeatWindowDays: 180 } }],
          wide: true,
          fold: "Show last year's Black Friday weekend, before and after",
        },
      ];
    }
  }
}

export interface NumbersItem {
  key: string;
  title: string;
  wide: boolean;
  fold: string | null;
  view: { ok: true; data: ViewData } | { ok: false };
}

// Draws every view for the signed-in brand. Each is built on its own: a period with no data, or a query that fails, leaves that one
// view marked failed and the others drawn. Never throws.
export async function loadNumbers(ctx: TenantContext, run: NumbersRun, deps: { db?: Db; rebuild?: typeof rebuildView } = {}): Promise<NumbersItem[]> {
  const build = deps.rebuild ?? rebuildView;
  const list = numbersRecipes(run.playbook, run, ctx.shop?.timezone ?? "UTC");
  const settled = await Promise.allSettled(list.map((r) => build(ctx, { component: r.component, sources: r.sources }, deps.db ? { db: deps.db } : {})));
  return list.map((r, i) => {
    const s = settled[i]!;
    return { key: r.key, title: r.title, wide: r.wide, fold: r.fold, view: s.status === "fulfilled" ? { ok: true as const, data: s.value } : { ok: false as const } };
  });
}
