import { formatGap, formatPct, formatValue, monthName, type Tone } from "@/lib/pace/format";
import type { PlanGap, PlanGapMap } from "@/lib/pace/gap";
import type { PlanMetric } from "@/lib/pace/metrics";
import type { PaceView } from "@/lib/pace/view";
import { METRICS } from "@/lib/metrics/registry";

const TONE: Record<Tone, string> = { ahead: "text-emerald-700", behind: "text-rose-700", even: "text-neutral-600" };
const PACED: PlanMetric[] = ["net_sales", "orders", "new_customer_orders"];
const COMPARED: PlanMetric[] = ["aov", "returning_customer_rate"];
const ALL: PlanMetric[] = [...PACED, ...COMPARED];

const monthDay = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

function Gap({ metric, g, currency }: { metric: PlanMetric; g: PlanGap; currency: string }) {
  const gap = formatGap(metric, g.gap, currency);
  const pct = formatPct(g.pctGap);
  return (
    <span className={TONE[gap.tone]}>
      {gap.text}
      {pct && METRICS[metric].unit !== "rate" ? ` (${pct})` : ""}
    </span>
  );
}

function PacedCard({ metric, g, currency }: { metric: PlanMetric; g: PlanGap; currency: string }) {
  const label = METRICS[metric].label;
  const fill = g.target > 0 ? Math.min(100, (g.actual / g.target) * 100) : 0;
  const mark = g.target > 0 ? Math.min(100, (g.planned / g.target) * 100) : 0;
  const money = (v: number) => formatValue(metric, v, currency);
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-sm text-neutral-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{money(g.actual)}</p>
      <p className="mt-1 text-sm">
        <Gap metric={metric} g={g} currency={currency} />
      </p>
      <div
        role="img"
        aria-label={`${label}: ${money(g.actual)} of a ${money(g.target)} target, ${money(g.planned)} planned so far`}
        className="relative mt-3 h-2 rounded-full bg-neutral-100"
      >
        <div className="h-2 rounded-full bg-neutral-800" style={{ width: `${fill}%` }} />
        <div className="absolute top-[-3px] h-[14px] w-[2px] bg-sky-600" style={{ left: `${mark}%` }} />
      </div>
      <dl className="mt-3 space-y-1 text-sm text-neutral-600">
        <div className="flex justify-between">
          <dt>Plan so far</dt>
          <dd>{money(g.planned)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Target for the month</dt>
          <dd>{money(g.target)}</dd>
        </div>
      </dl>
      {g.projected !== undefined ? (
        <p className="mt-3 text-sm">
          On this pace the month lands at about <span className="font-medium">{money(g.projected)}</span> <span className="text-neutral-500">(estimate)</span>
        </p>
      ) : null}
    </div>
  );
}

function CompareTable({ gaps, currency }: { gaps: PlanGapMap; currency: string }) {
  const rows = COMPARED.filter((m) => gaps[m]);
  if (rows.length === 0) return null;
  return (
    <table className="mt-4 w-full text-sm">
      <thead className="text-left text-neutral-500">
        <tr>
          <th className="py-1 font-normal">Held against the month&apos;s target</th>
          <th className="py-1 font-normal">Target</th>
          <th className="py-1 font-normal">So far</th>
          <th className="py-1 font-normal">Gap</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const g = gaps[m]!;
          return (
            <tr key={m} className="border-t border-neutral-100">
              <td className="py-1.5">{METRICS[m].label}</td>
              <td className="py-1.5">{formatValue(m, g.target, currency)}</td>
              <td className="py-1.5">{formatValue(m, g.actual, currency)}</td>
              <td className="py-1.5">
                <Gap metric={m} g={g} currency={currency} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SpreadNote({ gaps }: { gaps: PlanGapMap }) {
  const spreads = new Set(PACED.map((m) => gaps[m]?.spread).filter(Boolean));
  if (spreads.size === 0) return null;
  const parts = [
    spreads.has("last_year") ? "by last year's daily pattern" : null,
    spreads.has("even") ? "evenly across the days where the data has no matching month last year" : null,
  ].filter(Boolean);
  return <p className="mt-3 text-xs text-neutral-500">The month&apos;s targets are spread {parts.join(", and ")}. The month-end figure is an estimate with no range: what has happened so far, plus the rest of the plan scaled by how the month has gone against its plan so far.</p>;
}

export function PacePanel({ view, currency }: { view: PaceView; currency: string }) {
  const thisName = monthName(view.month);
  const thisGaps = view.thisMonth?.gaps;
  return (
    <div className="space-y-8">
      <section aria-labelledby="mtd">
        <h2 id="mtd" className="text-lg font-semibold tracking-tight">
          {thisName} to date
        </h2>
        {!view.hasPlan ? (
          <p className="mt-2 text-sm text-neutral-600">No plan has been loaded for this brand, so there is nothing to hold the month against.</p>
        ) : !view.started ? (
          <p className="mt-2 text-sm text-neutral-600">{thisName} hasn&apos;t started in the data: no day of it is complete yet. Last month is below.</p>
        ) : !thisGaps ? (
          <p className="mt-2 text-sm text-neutral-600">The plan doesn&apos;t have targets for {thisName}.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-neutral-600">Complete days only, through {monthDay(view.through)}.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {PACED.filter((m) => thisGaps[m]).map((m) => (
                <PacedCard key={m} metric={m} g={thisGaps[m]!} currency={currency} />
              ))}
            </div>
            <CompareTable gaps={thisGaps} currency={currency} />
            <SpreadNote gaps={thisGaps} />
          </>
        )}
      </section>

      {view.lastMonth ? (
        <section aria-labelledby="last">
          <h2 id="last" className="text-lg font-semibold tracking-tight">
            {monthName(view.lastMonth.month)} finished
          </h2>
          {view.lastMonth.gaps ? (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1 font-normal">Metric</th>
                  <th className="py-1 font-normal">Plan</th>
                  <th className="py-1 font-normal">Actual</th>
                  <th className="py-1 font-normal">Gap</th>
                </tr>
              </thead>
              <tbody>
                {ALL.filter((m) => view.lastMonth!.gaps![m]).map((m) => {
                  const g = view.lastMonth!.gaps![m]!;
                  return (
                    <tr key={m} className="border-t border-neutral-100">
                      <td className="py-1.5">{METRICS[m].label}</td>
                      <td className="py-1.5">{formatValue(m, g.planned, currency)}</td>
                      <td className="py-1.5">{formatValue(m, g.actual, currency)}</td>
                      <td className="py-1.5">
                        <Gap metric={m} g={g} currency={currency} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-sm text-neutral-600">The plan doesn&apos;t have targets for {monthName(view.lastMonth.month)}.</p>
          )}
        </section>
      ) : null}

      {view.planLabel ? <p className="text-xs text-neutral-500">Plan: {view.planLabel}.</p> : null}
    </div>
  );
}

