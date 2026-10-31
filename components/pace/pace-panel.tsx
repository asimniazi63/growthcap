import { ArrowDownRight, ArrowUpRight, CalendarClock, CalendarX, Minus, Target } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PaceTrack } from "@/components/pace/pace-track";
import { formatGap, formatPct, formatValue, monthName, type Tone } from "@/lib/pace/format";
import type { PlanGap, PlanGapMap } from "@/lib/pace/gap";
import type { PlanMetric } from "@/lib/pace/metrics";
import type { PaceView } from "@/lib/pace/view";
import { METRICS } from "@/lib/metrics/registry";

const TEXT_TONE: Record<Tone, string> = { ahead: "text-ahead", behind: "text-behind", even: "muted" };
const BADGE_TONE: Record<Tone, string> = { ahead: "badge-ahead", behind: "badge-behind", even: "" };
const ICON: Record<Tone, typeof Minus> = { ahead: ArrowUpRight, behind: ArrowDownRight, even: Minus };
const PACED: PlanMetric[] = ["net_sales", "orders", "new_customer_orders"];
const COMPARED: PlanMetric[] = ["aov", "returning_customer_rate"];
const ALL: PlanMetric[] = [...PACED, ...COMPARED];

const monthDay = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

function gapText(metric: PlanMetric, g: PlanGap, currency: string) {
  const gap = formatGap(metric, g.gap, currency);
  const pct = formatPct(g.pctGap);
  return { tone: gap.tone, text: gap.text, pct: pct && METRICS[metric].unit !== "rate" ? ` (${pct})` : "" };
}

// The gap as a chip: colour and an arrow say ahead or behind, the words say by how much.
function GapBadge({ metric, g, currency }: { metric: PlanMetric; g: PlanGap; currency: string }) {
  const { tone, text, pct } = gapText(metric, g, currency);
  const Icon = ICON[tone];
  return (
    <span className={`badge ${BADGE_TONE[tone]} max-w-full text-[13px]`}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>
        {text}
        {pct}
      </span>
    </span>
  );
}

// The gap inside a table cell.
function GapCell({ metric, g, currency }: { metric: PlanMetric; g: PlanGap; currency: string }) {
  const { tone, text, pct } = gapText(metric, g, currency);
  const Icon = ICON[tone];
  return (
    <span className={`inline-flex items-center justify-end gap-1.5 whitespace-nowrap font-medium ${TEXT_TONE[tone]}`}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>
        {text}
        {pct}
      </span>
    </span>
  );
}

function PacedCard({ metric, g, currency, primary }: { metric: PlanMetric; g: PlanGap; currency: string; primary: boolean }) {
  const label = METRICS[metric].label;
  const money = (v: number) => formatValue(metric, v, currency);
  const track = <PaceTrack label={label} actual={g.actual} planned={g.planned} target={g.target} projected={g.projected} money={money} size={primary ? "lg" : "md"} />;
  if (primary) {
    return (
      <div className="card p-5 sm:p-7">
        <div className="grid gap-6 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:items-center md:gap-10">
          <div>
            <p className="section-title">{label}</p>
            <p className="stat num mt-2 text-4xl sm:text-5xl">{money(g.actual)}</p>
            <p className="mt-3">
              <GapBadge metric={metric} g={g} currency={currency} />
            </p>
          </div>
          {track}
        </div>
      </div>
    );
  }
  return (
    <div className="card card-pad">
      <p className="text-sm font-medium muted">{label}</p>
      <p className="stat num mt-1.5 text-3xl">{money(g.actual)}</p>
      <p className="mt-2.5">
        <GapBadge metric={metric} g={g} currency={currency} />
      </p>
      <div className="mt-4">{track}</div>
    </div>
  );
}

function CompareTable({ gaps, currency }: { gaps: PlanGapMap; currency: string }) {
  const rows = COMPARED.filter((m) => gaps[m]);
  if (rows.length === 0) return null;
  return (
    <div className="card mt-6 overflow-hidden">
      <h3 id="held" className="section-title px-5 pt-4 pb-1">
        Held against the month&apos;s target
      </h3>
      <div className="overflow-x-auto">
        <table className="data-table" aria-labelledby="held">
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col" className="num">Target</th>
              <th scope="col" className="num">So far</th>
              <th scope="col" className="num">Gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const g = gaps[m]!;
              return (
                <tr key={m}>
                  <td>{METRICS[m].label}</td>
                  <td className="num">{formatValue(m, g.target, currency)}</td>
                  <td className="num">{formatValue(m, g.actual, currency)}</td>
                  <td className="num">
                    <GapCell metric={m} g={g} currency={currency} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SpreadNote({ gaps }: { gaps: PlanGapMap }) {
  const spreads = new Set(PACED.map((m) => gaps[m]?.spread).filter(Boolean));
  if (spreads.size === 0) return null;
  const parts = [
    spreads.has("last_year") ? "by last year's daily pattern" : null,
    spreads.has("even") ? "evenly across the days where the data has no matching month last year" : null,
  ].filter(Boolean);
  return <p className="muted mt-4 max-w-[70ch] text-[13px] leading-relaxed">The month&apos;s targets are spread {parts.join(", and ")}. The month-end figure is an estimate with no range: what has happened so far, plus the rest of the plan scaled by how the month has gone against its plan so far.</p>;
}

export function PacePanel({ view, currency }: { view: PaceView; currency: string }) {
  const thisName = monthName(view.month);
  const thisGaps = view.thisMonth?.gaps;
  const paced = thisGaps ? PACED.filter((m) => thisGaps[m]) : [];
  const [first, ...rest] = paced;
  return (
    <div className="space-y-10">
      <section aria-labelledby="mtd">
        <h2 id="mtd" className="section-title">
          {thisName} to date
        </h2>
        {!view.hasPlan ? (
          <div className="mt-4">
            <EmptyState icon={Target} title="No plan for this brand">
              No plan has been loaded for this brand, so there is nothing to hold the month against.
            </EmptyState>
          </div>
        ) : !view.started ? (
          <div className="mt-4">
            <EmptyState icon={CalendarClock} title="This month has not started">
              {thisName} hasn&apos;t started in the data: no day of it is complete yet. Last month is below.
            </EmptyState>
          </div>
        ) : !thisGaps ? (
          <div className="mt-4">
            <EmptyState icon={CalendarX} title="No targets for this month">
              The plan doesn&apos;t have targets for {thisName}.
            </EmptyState>
          </div>
        ) : (
          <>
            <p className="muted mt-1 text-sm">Complete days only, through {monthDay(view.through)}.</p>
            <div className="mt-4 space-y-4">
              {first ? <PacedCard metric={first} g={thisGaps[first]!} currency={currency} primary /> : null}
              {rest.length > 0 ? (
                <div className={`grid gap-4 ${rest.length > 1 ? "md:grid-cols-2" : ""}`}>
                  {rest.map((m) => (
                    <PacedCard key={m} metric={m} g={thisGaps[m]!} currency={currency} primary={false} />
                  ))}
                </div>
              ) : null}
            </div>
            <CompareTable gaps={thisGaps} currency={currency} />
            <SpreadNote gaps={thisGaps} />
          </>
        )}
      </section>

      {view.lastMonth ? (
        <section aria-labelledby="last">
          <h2 id="last" className="section-title">
            {monthName(view.lastMonth.month)} finished
          </h2>
          {view.lastMonth.gaps ? (
            <div className="card mt-4 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="data-table" aria-labelledby="last">
                  <thead>
                    <tr>
                      <th scope="col">Metric</th>
                      <th scope="col" className="num">Plan</th>
                      <th scope="col" className="num">Actual</th>
                      <th scope="col" className="num">Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ALL.filter((m) => view.lastMonth!.gaps![m]).map((m) => {
                      const g = view.lastMonth!.gaps![m]!;
                      return (
                        <tr key={m}>
                          <td>{METRICS[m].label}</td>
                          <td className="num">{formatValue(m, g.planned, currency)}</td>
                          <td className="num">{formatValue(m, g.actual, currency)}</td>
                          <td className="num">
                            <GapCell metric={m} g={g} currency={currency} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState icon={CalendarX} title="No targets for last month">
                The plan doesn&apos;t have targets for {monthName(view.lastMonth.month)}.
              </EmptyState>
            </div>
          )}
        </section>
      ) : null}

      {view.planLabel ? <p className="muted text-[13px]">Plan: {view.planLabel}.</p> : null}
    </div>
  );
}
