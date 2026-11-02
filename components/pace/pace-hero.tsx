"use client";

import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { GapBadge, NeedBadge } from "@/components/pace/gap-parts";
import { PaceChart } from "@/components/pace/pace-chart";
import { PaceScrubber } from "@/components/pace/pace-scrubber";
import { useReducedMotion } from "@/components/pace/use-reduced-motion";
import type { PaceAnnotation } from "@/lib/pace/annotation-types";
import { formatValue } from "@/lib/pace/format";
import type { PlanGap } from "@/lib/pace/gap";
import { gapAsOf, lastDayOf, nextPlayDay, playIntervalMs, seriesAsOf } from "@/lib/pace/scrub";
import type { PaceSeries } from "@/lib/pace/series";
import { METRICS } from "@/lib/metrics/registry";

const longDate = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

// The replay needs a few days to be worth moving through.
const MIN_REPLAY_DAYS = 3;

// The hero: net sales so far, whether that is ahead or behind, the three figures to hold it against, and the month drawn day by day.
// The slider under the chart replays the month: the line, the estimate and these figures all come from the days up to the one
// chosen. It starts on the last complete day, where `gap` (the figures the page was built with) is shown untouched.
export function PaceHero({ gap, series, currency, annotations = [], initialDay }: { gap: PlanGap; series: PaceSeries; currency: string; annotations?: readonly PaceAnnotation[]; initialDay?: number }) {
  const money = (v: number) => formatValue("net_sales", v, currency);
  const last = lastDayOf(series);
  const canReplay = last >= MIN_REPLAY_DAYS;
  const reducedMotion = useReducedMotion();
  const [day, setDay] = useState(() => Math.min(last, Math.max(1, Math.round(initialDay ?? last))));
  const [playing, setPlaying] = useState(false);
  const replaying = canReplay && day < last;

  const shownSeries = useMemo(() => (replaying ? seriesAsOf(series, day) : series), [replaying, series, day]);
  const g = useMemo(() => (replaying ? gapAsOf(series, day) : gap), [replaying, series, day, gap]);

  // The replay: one day forward at a time, so a month takes about eight seconds. It stops by itself at today, and never runs under a
  // request for less motion.
  const running = playing && !reducedMotion && day < last;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setDay((d) => nextPlayDay(d, last)), playIntervalMs(last));
    return () => clearInterval(id);
  }, [running, last]);

  // Any other click or key press in the hero pauses it (the Play button looks after itself).
  const pause = (e: SyntheticEvent) => {
    if (running && !(e.target as Element).closest("[data-play]")) setPlaying(false);
  };

  return (
    <div className="card p-5 sm:p-7" onPointerDownCapture={pause} onKeyDownCapture={pause}>
      <div className="grid gap-6 xl:grid-cols-[16rem_minmax(0,1fr)] xl:gap-10">
        <div className="min-w-0">
          <p className="muted font-medium">{replaying ? `${METRICS.net_sales.label} as of ${longDate(g.throughDate)}` : METRICS.net_sales.label}</p>
          <p className="stat num mt-1.5 text-4xl sm:text-5xl">{money(g.actual)}</p>
          <p className="mt-3">
            <GapBadge metric="net_sales" g={g} currency={currency} />
          </p>
          <NeedBadge metric="net_sales" g={g} currency={currency} className="mt-2.5 text-[13.5px]" />
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
          <PaceChart
            series={shownSeries}
            scale={series}
            replay={replaying}
            currency={currency}
            annotations={annotations}
            underChart={
              canReplay
                ? (plot) => <PaceScrubber days={series.days} day={day} last={last} onDay={setDay} playing={running} onPlaying={setPlaying} reducedMotion={reducedMotion} plot={plot} />
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
