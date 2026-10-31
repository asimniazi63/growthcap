import { ArrowDownRight, ArrowUpRight, FileText, Minus } from "lucide-react";
import Link from "next/link";
import { PaceChart } from "@/components/pace/pace-chart";
import { EmptyState } from "@/components/ui/empty-state";
import type { OverviewPace } from "@/lib/overview/data";
import { longDate } from "@/lib/overview/format";
import { formatGap, formatValue, monthName } from "@/lib/pace/format";

const TONE = {
  ahead: { style: "badge-ahead", Icon: ArrowUpRight },
  behind: { style: "badge-behind", Icon: ArrowDownRight },
  even: { style: "badge-brand", Icon: Minus },
} as const;

// This month's net sales against the plan: the figure, how far ahead or behind, and the month so far as a line chart.
export function SalesCard({ view, currency, canPlan }: { view: OverviewPace; currency: string; canPlan: boolean }) {
  const gap = view.thisMonth?.gaps?.net_sales;
  const planLink = canPlan ? (
    <Link href="/plan" className="btn btn-secondary btn-sm">
      Open Plan
    </Link>
  ) : undefined;

  let empty: { title: string; text: string } | null = null;
  if (!view.started) empty = { title: "The month has just started", text: "Net sales against plan show up once the first day has finished." };
  else if (!view.hasPlan) empty = { title: "No plan to measure against yet", text: canPlan ? "Upload a plan or a statement of work and confirm its targets, and this month's pace shows here." : "Growth Capital hasn't added a plan for this brand yet." };
  else if (!view.thisMonth) empty = { title: "No orders counted yet this month", text: "The store has no complete day of orders this month so far." };
  else if (!gap) empty = { title: `The plan has no net sales target for ${monthName(view.month)}`, text: canPlan ? "Add one in Plan and this card fills in." : "Growth Capital hasn't set one yet." };

  return (
    <section className="card card-pad" aria-labelledby="ov-sales">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
        <h2 id="ov-sales" className="section-title">
          Net sales this month
        </h2>
        {gap ? <GapBadge gap={gap.gap} currency={currency} /> : null}
      </div>
      {empty || !gap ? (
        <EmptyState icon={FileText} title={empty?.title ?? "No net sales target"} action={planLink}>
          {empty?.text}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <p className="stat text-[2.5rem]">{formatValue("net_sales", gap.actual, currency)}</p>
            <p className="muted text-sm">
              {gap.projected !== undefined ? `estimate ${formatValue("net_sales", gap.projected, currency)} by month end, ` : ""}target {formatValue("net_sales", gap.target, currency)}
            </p>
          </div>
          <p className="faint mt-1 text-xs">Complete days through {longDate(view.through)}.</p>
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
