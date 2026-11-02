import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatRange, formatUnit } from "@/lib/pace/format";
import type { ViewData } from "@/lib/views/types";
import { CaveatsNote } from "./caveats-note";
import { NumbersTable } from "./numbers-table";

type Data = Extract<ViewData, { component: "lift_dip" }>;

// A promotion read as three level bars: the average day before the window, in it, and after it. The result has period totals and
// per-day rates, not a daily series, so each bar is a period's average day. The dashed line is the baseline; the hatched parts are
// the estimated difference from it: extra sales above the line in the window, sales pulled forward below the line after it.
// The labels on the chart are the result's own fields. Colour is never the only cue: hatch angle, position and words say it too.

const STRIPES = (colour: string, angle: number) =>
  `repeating-linear-gradient(${angle}deg, color-mix(in oklab, var(--color-${colour}) 75%, transparent) 0 2px, transparent 2px 6px), color-mix(in oklab, var(--color-${colour}) 10%, transparent)`;
const NEUTRAL_BAR = "color-mix(in oklab, var(--color-ink-3) 24%, var(--color-surface))";
const WINDOW_BAR = "color-mix(in oklab, var(--color-brand) 30%, var(--color-surface))";
const percent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

export function LiftDip({ data, currency }: { data: Data; currency: string }) {
  const money = (cents: number) => formatUnit("money", Math.abs(cents), currency);
  const { baseline, window: promo, after } = data;
  const afterSeen = after.daysObserved > 0;
  const dip = data.pulledForwardNetSalesCents > 0;

  // The tallest bar reaches 70% of the plot, so the labels above the bars have room.
  const top = Math.max(1, baseline.perDayCents, promo.perDayCents, afterSeen ? after.perDayCents : 0) / 0.7;
  const at = (cents: number) => Math.min(100, Math.max(0, (cents / top) * 100));
  const base = at(baseline.perDayCents);
  const win = at(promo.perDayCents);
  const aft = afterSeen ? at(after.perDayCents) : 0;

  const extraUp = data.extraNetSalesCents >= 0;
  const lift = data.netLiftNetSalesCents;
  const LiftIcon = lift > 0 ? ArrowUpRight : lift < 0 ? ArrowDownRight : Minus;
  const liftTone = lift > 0 ? "bg-ahead-tint text-ahead" : lift < 0 ? "bg-behind-tint text-behind" : "bg-paper-2 text-ink-2";
  const liftWords = lift === 0 ? "no net lift" : `net lift ${lift < 0 ? "down " : ""}${money(lift)}`;
  const extraWords = data.extraNetSalesCents === 0 ? "no extra sales" : extraUp ? `extra sales ${money(data.extraNetSalesCents)}` : `sales ${money(data.extraNetSalesCents)} below the baseline`;
  const dipWords = !afterSeen ? "no days after the window in the data yet" : dip ? `${money(data.pulledForwardNetSalesCents)} of sales pulled forward${after.fullyObserved ? "" : " so far"}` : "no dip after the window";
  const label = [
    `Average day of net sales before, during and after${data.code ? ` the ${data.code} promotion` : " the promotion"}`,
    `before: ${money(baseline.perDayCents)} a day over ${baseline.days} days`,
    `during: ${money(promo.perDayCents)} a day over ${promo.days} days, ${extraWords}`,
    afterSeen ? `after: ${money(after.perDayCents)} a day over ${after.daysObserved} days, ${dipWords}` : `after: ${dipWords}`,
    liftWords,
  ].join("; ");

  const place = (v: number) => ({ bottom: `calc(${v}% + 6px)` });
  const { promo: p, comparison: c } = data.customers;
  const rateMax = Math.max(p.repeatRate ?? 0, c.repeatRate ?? 0);
  const gap = data.customers.repeatRateGap;
  const GapIcon = gap !== null && gap > 0 ? ArrowUpRight : gap !== null && gap < 0 ? ArrowDownRight : Minus;

  return (
    <>
      {data.code ? (
        <p className="muted mb-2 text-[13px]">
          Discount code <span className="badge font-mono text-[11px]">{data.code}</span>
        </p>
      ) : null}

      <div className="relative">
        <div className="flex justify-end">
          <p className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 ${liftTone}`}>
            <LiftIcon className="size-4 shrink-0" aria-hidden />
            <span className="text-[13px] font-medium">Net lift</span>
            <span className="num text-base font-semibold">{money(lift)}</span>
          </p>
        </div>

        <div role="img" aria-label={label} className="mt-2">
          <div aria-hidden className="relative h-56 sm:h-64">
            <div className="grid h-full grid-cols-3 gap-2 sm:gap-5">
              {/* before: the baseline bar and its label */}
              <div className="relative">
                <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-44 rounded-t-md" style={{ height: `${base}%`, background: NEUTRAL_BAR }} />
                <p className="muted absolute inset-x-0 text-center text-[12px] font-medium" style={place(base)}>Baseline</p>
              </div>

              {/* during: the window's average day. The band below the baseline is what it would have sold anyway; the hatched part
                  above it (or below it, for a shortfall) is the estimated difference. */}
              <div className="relative">
                <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-44 rounded-t-md" style={{ height: `${Math.min(win, base)}%`, background: WINDOW_BAR }} />
                {win !== base ? (
                  <div
                    className="absolute inset-x-0 mx-auto w-full max-w-44"
                    style={{ bottom: `${Math.min(win, base)}%`, height: `${Math.abs(win - base)}%`, background: extraUp ? STRIPES("ahead", 45) : STRIPES("behind", 135) }}
                  />
                ) : null}
                <div className="absolute inset-x-0 mx-auto h-[3px] w-full max-w-44 bg-brand" style={{ bottom: `${win}%` }} />
                <p className={`absolute inset-x-0 text-center leading-tight ${extraUp ? "text-ahead" : "text-behind"}`} style={place(Math.max(win, base))}>
                  <span className="block text-[12px] font-medium">{extraUp ? "Extra sales" : "Below baseline"}</span>
                  <span className="num block text-[14px] font-semibold">{money(data.extraNetSalesCents)}</span>
                </p>
              </div>

              {/* after: what the days after the window sold, with the shortfall against the baseline hatched */}
              <div className="relative">
                {afterSeen ? (
                  <>
                    <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-44 rounded-t-md border-t-[3px] border-ink-2" style={{ height: `${aft}%`, background: NEUTRAL_BAR }} />
                    {dip && aft < base ? <div className="absolute inset-x-0 mx-auto w-full max-w-44" style={{ bottom: `${aft}%`, height: `${base - aft}%`, background: STRIPES("behind", 135) }} /> : null}
                    <p className={`absolute inset-x-0 text-center leading-tight ${dip ? "text-behind" : "muted"}`} style={place(Math.max(aft, base))}>
                      {dip ? (
                        <>
                          <span className="block text-[12px] font-medium">{after.fullyObserved ? "Pulled forward" : "Pulled forward so far"}</span>
                          <span className="num block text-[14px] font-semibold">{money(data.pulledForwardNetSalesCents)}</span>
                        </>
                      ) : (
                        <span className="block text-[12px] font-medium">{after.fullyObserved ? "No dip after the window" : "No dip so far"}</span>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="muted absolute inset-x-0 text-center text-[12px] font-medium leading-tight" style={place(base)}>
                    No days after the window in the data yet
                  </p>
                )}
              </div>
            </div>
            {/* the baseline, across all three */}
            <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-ink" style={{ bottom: `${base}%` }} />
          </div>

          <div aria-hidden className="mt-2 grid grid-cols-3 gap-2 border-t border-line-strong pt-2 sm:gap-5">
            <Period name="Before" dates={formatRange(baseline.from, baseline.to)} days={`${baseline.days} ${baseline.days === 1 ? "day" : "days"}`} perDay={money(baseline.perDayCents)} />
            <Period name="During" dates={formatRange(promo.from, promo.to)} days={`${promo.days} ${promo.days === 1 ? "day" : "days"}`} perDay={money(promo.perDayCents)} />
            {afterSeen ? (
              <Period
                name="After"
                dates={formatRange(after.from, after.to)}
                days={after.fullyObserved ? `${after.daysObserved} days` : `${after.daysObserved} days so far`}
                perDay={money(after.perDayCents)}
              />
            ) : (
              <Period name="After" dates="Not in the data yet" days="" perDay="" />
            )}
          </div>
        </div>
      </div>

      <p className="muted mt-3 text-[13px]">
        Each bar is the average day in that period. The dashed line is the baseline: the days before the window, at their daily rate. Hatched parts are estimates against it, not measured sales.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[13px]">
        <span className="font-medium">{`Customers who came back within ${data.customers.repeatWindowDays} days`}</span>
        <Rate who="First bought in the window" rate={p.repeatRate} counted={p.customers} max={rateMax} tone="bg-brand" />
        <Rate who="Comparison" rate={c.repeatRate} counted={c.customers} max={rateMax} tone="bg-ink-3" />
        {gap !== null ? (
          <span className={`inline-flex items-center gap-1 font-medium ${gap > 0 ? "text-ahead" : gap < 0 ? "text-behind" : "muted"}`}>
            <GapIcon className="size-3.5 shrink-0" aria-hidden />
            {gap === 0 ? "no gap" : `${(Math.abs(gap) * 100).toFixed(1)} points ${gap > 0 ? "higher" : "lower"}`}
          </span>
        ) : null}
      </div>

      <CaveatsNote items={data.caveats} />

      <NumbersTable
        sections={[
          {
            head: ["Period", "Dates", "Days", "Net sales", "Average day"],
            rows: [
              ["Before (baseline)", formatRange(baseline.from, baseline.to), String(baseline.days), money(baseline.netSalesCents), money(baseline.perDayCents)],
              ["During the window", formatRange(promo.from, promo.to), String(promo.days), money(promo.netSalesCents), money(promo.perDayCents)],
              afterSeen
                ? ["After the window", formatRange(after.from, after.to), String(after.daysObserved), money(after.netSalesCents), money(after.perDayCents)]
                : ["After the window", "Not in the data yet", "0", "—", "—"],
            ],
            caption: "Net sales are after discounts and refunds. The average day is the period's net sales over its days.",
          },
          {
            head: ["Against the baseline", "Net sales"],
            rows: [
              ["Expected in the window", money(promo.expectedNetSalesCents)],
              ["Extra sales", `${data.extraNetSalesCents < 0 ? "below by " : ""}${money(data.extraNetSalesCents)}`],
              ["Expected after the window", afterSeen ? money(after.expectedNetSalesCents) : "—"],
              ["Pulled forward", money(data.pulledForwardNetSalesCents)],
              ["Net lift", `${lift < 0 ? "down " : ""}${money(lift)}`],
            ],
          },
          {
            head: [`Repeat within ${data.customers.repeatWindowDays} days`, "Customers counted", "Repeat rate"],
            rows: [
              ["First order in the window", String(p.customers), p.repeatRate === null ? "—" : percent(p.repeatRate)],
              ["Comparison customers", String(c.customers), c.repeatRate === null ? "—" : percent(c.repeatRate)],
            ],
          },
        ]}
      />
    </>
  );
}

function Period({ name, dates, days, perDay }: { name: string; dates: string; days: string; perDay: string }) {
  return (
    <div className="min-w-0 text-center">
      <p className="text-[13px] font-medium">{name}</p>
      <p className="muted text-[11.5px] leading-snug">{dates}</p>
      {perDay ? (
        <p className="num mt-0.5 text-[13px] font-semibold">
          {perDay}
          <span className="muted font-normal"> a day</span>
        </p>
      ) : null}
      {days ? <p className="muted text-[11.5px]">{days}</p> : null}
    </div>
  );
}

function Rate({ who, rate, counted, max, tone }: { who: string; rate: number | null; counted: number; max: number; tone: string }) {
  return (
    <span className="inline-flex items-center gap-x-2 whitespace-nowrap">
      <span className="muted">{who}</span>
      {rate === null ? (
        <span className="muted">no rate yet, nobody is old enough</span>
      ) : (
        <>
          <span aria-hidden className="inline-block h-1.5 w-12 rounded-full bg-paper-2">
            <span className={`block h-full rounded-full ${tone}`} style={{ width: `${max > 0 ? Math.round((rate / max) * 100) : 0}%` }} />
          </span>
          <span className="num font-semibold">{percent(rate)}</span>
          <span className="muted num">{`of ${counted}`}</span>
        </>
      )}
    </span>
  );
}
