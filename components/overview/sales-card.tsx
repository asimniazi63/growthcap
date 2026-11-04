import { ArrowDownRight, ArrowUpRight, FileText, Minus } from "lucide-react";
import Link from "next/link";
import { PaceChart } from "@/components/pace/pace-chart";
import { CountUp } from "@/components/ui/count-up";
import { EmptyState } from "@/components/ui/empty-state";
import { MonthPicker } from "@/components/ui/month-picker";
import { Sparkline } from "@/components/ui/sparkline";
import type { OverviewPace } from "@/lib/overview/data";
import { longDate } from "@/lib/overview/format";
import { isPlanHit } from "@/lib/overview/plan-hit";
import { netSalesSpark, netSalesSparkLabel } from "@/lib/overview/spark";
import { monthStart } from "@/lib/metrics/dates";
import { METRICS } from "@/lib/metrics/registry";
import { earlyBasis, formatGap, formatPct, formatRange, formatValue, monthName } from "@/lib/pace/format";
import type { PaceMonth } from "@/lib/pace/view";
import { PlanHit } from "./plan-hit";

const TONE = {
  ahead: { style: "badge-ahead", Icon: ArrowUpRight },
  behind: { style: "badge-behind", Icon: ArrowDownRight },
  even: { style: "badge-brand", Icon: Minus },
} as const;

// "October" from "2026-10".
const monthOnly = (month: string) => monthName(month).split(" ")[0]!;

// This month's net sales against the plan: the figure, how far ahead or behind, and the month so far as a line chart. With
// `months` it has a picker that switches it to a past month, shown whole. `scope` keeps the once-a-session "plan hit" moment
// separate for each brand.
export function SalesCard({ view, currency, canPlan, scope = "brand", months }: { view: OverviewPace; currency: string; canPlan: boolean; scope?: string; months?: readonly PaceMonth[] }) {
  const gap = view.thisMonth?.gaps?.net_sales;
  const title = view.closed ? `Net sales in ${monthName(view.month)}` : "Net sales this month";
  const picker = months && months.length > 1 ? <MonthPicker months={months} selected={view.month} label="Month for net sales" /> : null;
  // A young month says little yet, so the card also says how last month finished. Young: no month-end estimate yet, or no
  // complete day at all.
  const lastMonthNote = !view.closed && (!view.started || gap?.earlyMonth !== undefined) ? <LastMonthLine view={view} currency={currency} /> : null;
  const planLink = canPlan ? (
    <Link href="/plan" className="btn btn-secondary btn-sm">
      Open Plan
    </Link>
  ) : undefined;

  let empty: { title: string; text: string } | null = null;
  if (!view.started) empty = { title: "The month has just started", text: "Net sales against plan show up once the first day has finished." };
  else if (!view.hasPlan) empty = { title: "No plan to measure against yet", text: canPlan ? "Upload a plan or a statement of work and confirm its targets, and this month's pace shows here." : "Growth Capital hasn't added a plan for this brand yet." };
  else if (!view.thisMonth) empty = view.closed ? { title: `No orders in ${monthName(view.month)}`, text: "The store had no orders that month." } : { title: "No orders counted yet this month", text: "The store has no complete day of orders this month so far." };
  else if (!gap) empty = { title: `The plan has no net sales target for ${monthName(view.month)}`, text: canPlan ? "Add one in Plan and this card fills in." : "Growth Capital hasn't set one yet." };

  const spark = netSalesSpark(view.series);

  return (
    <section className="card card-pad" aria-labelledby="ov-sales">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="ov-sales" className="section-title">
          {title}
        </h2>
        {gap || picker ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* The celebration is for this month only: a past month that hit its target just shows the ahead badge. */}
            {gap && !view.closed && isPlanHit(gap) ? <PlanHit month={view.month} scope={scope} /> : null}
            {gap ? <GapBadge gap={gap.gap} currency={currency} /> : null}
            {picker}
          </div>
        ) : null}
      </div>
      {empty || !gap ? (
        <EmptyState icon={FileText} title={empty?.title ?? "No net sales target"} action={planLink}>
          {empty?.text}
          {lastMonthNote}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
                <p className="stat text-[2.5rem]">
                  <CountUp value={gap.actual} unit={METRICS.net_sales.unit} currency={currency} />
                </p>
                <p className="muted text-sm">
                  {gap.projected !== undefined ? `estimate ${formatValue("net_sales", gap.projected, currency)} by month end, ` : ""}target {formatValue("net_sales", gap.target, currency)}
                </p>
              </div>
              <p className="faint mt-1 text-xs">
                {view.closed ? (
                  `The whole month, ${formatRange(monthStart(view.month), view.through)}.`
                ) : (
                  <>
                    Complete days through {longDate(view.through)}.
                    {gap.earlyMonth ? ` ${earlyBasis(gap.earlyMonth)}, so no month-end estimate until ${gap.earlyMonth.estimateAfterDays} days are complete.` : ""}
                  </>
                )}
              </p>
              {lastMonthNote}
            </div>
            {spark ? <Sparkline values={spark.values} plan={spark.plan} label={netSalesSparkLabel(spark, currency, view.closed ? view.month : undefined)} /> : null}
          </div>
          {view.series ? (
            <div className="mt-3">
              <PaceChart series={view.series} currency={currency} compact />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

// "October finished at $9,512.40, $940.10 behind plan (9.0% behind). See October": last month whole, with a link that switches the
// card to it. Nothing when last month had no net sales target, since the figure comes from its gap.
function LastMonthLine({ view, currency }: { view: OverviewPace; currency: string }) {
  const last = view.lastMonth;
  const g = last?.gaps?.net_sales;
  if (!last || !g) return null;
  const name = monthOnly(last.month);
  const pct = g.gap === 0 ? null : formatPct(g.pctGap);
  const text = `${name} finished at ${formatValue("net_sales", g.actual, currency)}, ${formatGap("net_sales", g.gap, currency).text}${pct ? ` (${pct})` : ""}.`;
  return (
    <p className="muted mt-2 text-sm">
      {text}{" "}
      <Link href={`/overview?month=${last.month}`} scroll={false} className="font-medium text-brand-strong underline decoration-brand/40 underline-offset-2 hover:decoration-brand">
        See {name}
      </Link>
    </p>
  );
}

function GapBadge({ gap, currency }: { gap: number; currency: string }) {
  const { text, tone } = formatGap("net_sales", gap, currency);
  const { style, Icon } = TONE[tone];
  return (
    <span className={`badge ${style}`}>
      <Icon className="size-3.5" aria-hidden />
      {text}
    </span>
  );
}
