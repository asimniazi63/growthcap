import { ArrowDownRight, ArrowUpRight, CalendarClock, CalendarX, Minus, Target } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PaceChart } from "@/components/pace/pace-chart";
import { PaceTrack } from "@/components/pace/pace-track";
import { formatGap, formatPct, formatValue, monthName, type Tone } from "@/lib/pace/format";
import type { PlanGap, PlanGapMap } from "@/lib/pace/gap";
import type { PlanMetric } from "@/lib/pace/metrics";
import type { PaceSeries } from "@/lib/pace/series";
import type { PaceView } from "@/lib/pace/view";
import { METRICS } from "@/lib/metrics/registry";

const TEXT_TONE: Record<Tone, string> = { ahead: "text-ahead", behind: "text-behind", even: "muted" };
const BADGE_TONE: Record<Tone, string> = { ahead: "badge-ahead", behind: "badge-behind", even: "" };
const ICON: Record<Tone, typeof Minus> = { ahead: ArrowUpRight, behind: ArrowDownRight, even: Minus };
const PACED: PlanMetric[] = ["net_sales", "orders", "new_customer_orders"];
const COMPARED: PlanMetric[] = ["aov", "returning_customer_rate"];
const ALL: PlanMetric[] = [...PACED, ...COMPARED];
const TILES: PlanMetric[] = ["orders", "new_customer_orders", "aov", "returning_customer_rate"];

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

// The fallback hero, for when the days can't be drawn: the progress track with the same figures written out.
function TrackHero({ g, currency }: { g: PlanGap; currency: string }) {
  const label = METRICS.net_sales.label;
  const money = (v: number) => formatValue("net_sales", v, currency);
  return (
    <div className="card p-5 sm:p-7">
      <div className="grid gap-6 md:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] md:items-center md:gap-10">
        <div>
          <p className="section-title">{label}</p>
          <p className="stat num mt-2 text-4xl sm:text-5xl">{money(g.actual)}</p>
          <p className="mt-3">
            <GapBadge metric="net_sales" g={g} currency={currency} />
          </p>
        </div>
        <PaceTrack label={label} actual={g.actual} planned={g.planned} target={g.target} projected={g.projected} money={money} size="lg" />
      </div>
    </div>
  );
}

// The hero: net sales so far, whether that is ahead or behind, the three figures to hold it against, and the month drawn day by day.
function ChartHero({ g, series, currency }: { g: PlanGap; series: PaceSeries; currency: string }) {
  const money = (v: number) => formatValue("net_sales", v, currency);
  return (
    <div className="card p-5 sm:p-7">
      <div className="grid gap-6 xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-10">
        <div className="min-w-0">
          <p className="muted font-medium">{METRICS.net_sales.label}</p>
          <p className="stat num mt-1.5 text-4xl sm:text-5xl">{money(g.actual)}</p>
          <p className="mt-3">
            <GapBadge metric="net_sales" g={g} currency={currency} />
          </p>
          <dl className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div>
              <dt className="faint text-[13px]">Plan so far</dt>
              <dd className="num text-base font-semibold">{money(g.planned)}</dd>
            </div>
            {g.projected !== undefined ? (
              <div>
                <dt className="faint text-[13px]">Month-end estimate</dt>
                <dd className="num flex items-center gap-2 text-base font-semibold">
                  <span aria-hidden className="hatch h-2.5 w-5 shrink-0 rounded-[3px] border border-dashed border-estimate" />
                  {money(g.projected)}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="faint text-[13px]">Target for the month</dt>
              <dd className="num text-base font-semibold">{money(g.target)}</dd>
            </div>
          </dl>
        </div>
        <div className="min-w-0">
          <PaceChart series={series} currency={currency} />
        </div>
      </div>
    </div>
  );
}

// The gap on a centred bar: right of the tick is ahead of plan, left is behind. A quarter either way fills half the bar.
function VarianceBar({ pct }: { pct: number | null }) {
  const width = pct === null ? 0 : (Math.min(Math.abs(pct), 0.25) / 0.25) * 50;
  return (
    <div aria-hidden>
      <div className="relative h-2 rounded-full bg-paper-2">
        {pct !== null && pct > 0 ? <span className="absolute inset-y-0 left-1/2 rounded-r-full bg-ahead" style={{ width: `${width.toFixed(1)}%` }} /> : null}
        {pct !== null && pct < 0 ? <span className="absolute inset-y-0 right-1/2 rounded-l-full bg-behind" style={{ width: `${width.toFixed(1)}%` }} /> : null}
        <span className="absolute -inset-y-1 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-ink" />
      </div>
      <div className="faint mt-1.5 flex justify-between text-[11.5px]">
        <span>Behind</span>
        <span>On plan</span>
        <span>Ahead</span>
      </div>
    </div>
  );
}

function MetricTile({ metric, g, currency }: { metric: PlanMetric; g: PlanGap; currency: string }) {
  const money = (v: number) => formatValue(metric, v, currency);
  const { tone, text, pct } = gapText(metric, g, currency);
  const paced = PACED.includes(metric);
  return (
    <div className="card flex min-w-0 flex-col p-4 sm:px-[18px]">
      <p className="text-[13.5px] text-ink-2">{METRICS[metric].label}</p>
      <p className="stat num mt-1 mb-3 text-3xl">{money(g.actual)}</p>
      <VarianceBar pct={g.pctGap} />
      <p className={`mt-2.5 text-[13px] font-semibold ${TEXT_TONE[tone]}`}>
        {text}
        {pct}
      </p>
      {paced ? (
        <>
          <p className="faint mt-1 text-[12.5px]">Plan so far {money(g.planned)}</p>
          {g.projected !== undefined ? (
            <p className="faint mt-0.5 flex items-start gap-1.5 text-[12.5px]">
              <span aria-hidden className="hatch mt-[5px] h-2 w-4 shrink-0 rounded-[2px] border border-dashed border-estimate" />
              <span>
                Estimate {money(g.projected)} · target {money(g.target)}
              </span>
            </p>
          ) : (
            <p className="faint mt-0.5 text-[12.5px]">Target {money(g.target)}</p>
          )}
        </>
      ) : (
        <p className="faint mt-1 text-[12.5px]">Target {money(g.target)}</p>
      )}
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
  const net = thisGaps?.net_sales;
  const tiles = thisGaps ? TILES.filter((m) => thisGaps[m]) : [];
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
              {net ? view.series ? <ChartHero g={net} series={view.series} currency={currency} /> : <TrackHero g={net} currency={currency} /> : null}
              {tiles.length > 0 ? (
                <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
                  {tiles.map((m) => (
                    <MetricTile key={m} metric={m} g={thisGaps[m]!} currency={currency} />
                  ))}
                </div>
              ) : null}
            </div>
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
