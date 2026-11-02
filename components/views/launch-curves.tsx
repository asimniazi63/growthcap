import { formatUnit } from "@/lib/pace/format";
import type { LaunchBenchmarkWeek, LaunchCard, ViewData } from "@/lib/views/types";
import { CaveatsNote } from "./caveats-note";
import { NumbersTable } from "./numbers-table";

type Data = Extract<ViewData, { component: "launch_curves" }>;

// Small multiples: one curve per launch (cumulative units since its first sale), newest first, with the median launch behind it
// as a faint area. The cards in a row of four share one scale, so their curves can be compared; a week that is not over yet
// is drawn dashed and ends early, with a hollow end mark. Product titles are store text and are only ever rendered as text.

const PER_ROW = 4;
const VIEW_W = 100;
const VIEW_H = 40;
const PAD = 3; // keeps the strokes inside the box
const MEDIAN_FILL = "color-mix(in oklab, var(--color-ink-3) 18%, transparent)";
const count = (n: number) => formatUnit("count", n, "USD");
const shortDate = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));

interface Pt {
  x: number; // weeks since the first sale
  y: number; // cumulative units
}

// Full weeks end on a whole week; a partial week ends part of the way through it.
function curveOf(card: LaunchCard): { solid: Pt[]; partial: Pt[] | null; end: Pt; endsEarly: boolean } {
  const solid: Pt[] = [{ x: 0, y: 0 }];
  let partial: Pt[] | null = null;
  for (const w of card.weeks) {
    if (w.daysObserved >= 7) solid.push({ x: w.week, y: w.cumulativeUnits });
    else partial = [solid.at(-1)!, { x: w.week - 1 + w.daysObserved / 7, y: w.cumulativeUnits }];
  }
  return { solid, partial, end: (partial ?? solid).at(-1)!, endsEarly: partial !== null };
}

export function LaunchCurves({ data }: { data: Data }) {
  const { launches, benchmark } = data;
  if (launches.length === 0) {
    return (
      <>
        <p className="muted text-sm">No launches to draw in this period.</p>
        <CaveatsNote items={data.caveats} />
      </>
    );
  }

  const curves = launches.map(curveOf);
  const weekSpan = Math.max(1, benchmark.at(-1)?.week ?? 0, ...curves.map((c) => c.end.x));
  const medianAt = (week: number) => benchmark.find((b) => b.week === week)?.medianCumulativeUnits;
  const rows: number[][] = [];
  for (let i = 0; i < launches.length; i += PER_ROW) rows.push(launches.slice(i, i + PER_ROW).map((_, k) => i + k));
  const rowTop = (idx: number[]) => Math.max(1, ...idx.map((i) => curves[i]!.end.y), ...benchmark.map((b) => b.medianCumulativeUnits));
  const weekColumns = Math.max(benchmark.length, ...launches.map((l) => l.weeks.length));
  const lastBench = benchmark.at(-1);

  return (
    <>
      <div className="space-y-4">
        {rows.map((idx, r) => {
          const yMax = rowTop(idx);
          return (
            <div key={r}>
              <p className="muted mb-1.5 text-[11.5px]">{`Same scale across this row: 0 to ${count(yMax)} units`}</p>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {idx.map((i) => (
                  <Card key={i} card={launches[i]!} curve={curves[i]!} benchmark={benchmark} weekSpan={weekSpan} yMax={yMax} medianAt={medianAt} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <ul className="muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]" aria-label="How to read the curves">
        <li className="inline-flex items-center gap-1.5">
          <svg aria-hidden viewBox="0 0 20 8" className="w-5"><line x1="0" x2="20" y1="4" y2="4" stroke="var(--color-brand)" strokeWidth="2.25" strokeLinecap="round" /></svg>
          This launch, units added up week by week
        </li>
        {benchmark.length > 0 ? (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-5 rounded-sm border-t border-ink-3" style={{ background: MEDIAN_FILL }} />
            The median launch in this store
          </li>
        ) : null}
        <li className="inline-flex items-center gap-1.5">
          <svg aria-hidden viewBox="0 0 20 8" className="w-5"><line x1="0" x2="20" y1="4" y2="4" stroke="var(--color-brand)" strokeWidth="2.25" strokeDasharray="4 3" strokeLinecap="round" /></svg>
          A week that is not over yet
        </li>
      </ul>
      <p className="muted mt-2 text-[13px]">
        {`A launch is a product's first sale, week 1 being the launch day and the six after it. Units are before refunds.`}
        {lastBench ? ` The median rests on ${benchmark[0]!.launches === lastBench.launches ? `${count(lastBench.launches)} launches` : `${count(benchmark[0]!.launches)} launches in week 1 and ${count(lastBench.launches)} by week ${lastBench.week}`}.` : ""}
        {data.truncated ? ` Showing ${data.truncated.shown} of ${data.truncated.total} launches, newest first.` : ""}
      </p>
      <CaveatsNote items={data.caveats} />

      <NumbersTable
        sections={[
          {
            caption: "Units added up since the first sale, at the end of each week",
            head: ["Launch", "First sale", "Days", "Total units", ...Array.from({ length: weekColumns }, (_, k) => `Week ${k + 1}`)],
            rows: [
              ...launches.map((l) => [
                l.title,
                shortDate(l.launchDate),
                String(l.daysObserved),
                count(l.totalUnits),
                ...Array.from({ length: weekColumns }, (_, k) => {
                  const w = l.weeks.find((x) => x.week === k + 1);
                  return !w ? "—" : w.daysObserved >= 7 ? count(w.cumulativeUnits) : `${count(w.cumulativeUnits)} (${w.daysObserved} of 7 days)`;
                }),
              ]),
              ["Median launch", "", "", "", ...Array.from({ length: weekColumns }, (_, k) => (medianAt(k + 1) === undefined ? "—" : count(medianAt(k + 1)!)))],
              ["Launches behind the median", "", "", "", ...Array.from({ length: weekColumns }, (_, k) => String(benchmark.find((b) => b.week === k + 1)?.launches ?? "—"))],
            ],
          },
        ]}
      />
    </>
  );
}

function Card({ card, curve, benchmark, weekSpan, yMax, medianAt }: { card: LaunchCard; curve: ReturnType<typeof curveOf>; benchmark: LaunchBenchmarkWeek[]; weekSpan: number; yMax: number; medianAt: (week: number) => number | undefined }) {
  const x = (week: number) => (week / weekSpan) * VIEW_W;
  const y = (units: number) => VIEW_H - PAD - (units / yMax) * (VIEW_H - 2 * PAD);
  const floor = y(0);
  const pts = (list: Pt[]) => list.map((p) => `${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`).join(" ");
  const median: Pt[] = [{ x: 0, y: 0 }, ...benchmark.map((b) => ({ x: b.week, y: b.medianCumulativeUnits }))];
  const lastFull = curve.solid.at(-1)!.x;
  const medianThen = lastFull > 0 ? medianAt(lastFull) : undefined;
  const label = `${card.title}: ${count(card.totalUnits)} units in ${card.daysObserved} days since its first sale on ${shortDate(card.launchDate)}${curve.endsEarly ? ", the last week not over yet" : ""}${medianThen !== undefined ? `. After week ${lastFull} the median launch had ${count(medianThen)}` : ""}`;
  return (
    <figure className="inset min-w-0 p-2.5">
      <figcaption>
        <p className="truncate text-[13px] font-medium" title={card.title}>{card.title}</p>
        <p className="muted text-[11.5px]">{`First sale ${shortDate(card.launchDate)}`}</p>
      </figcaption>
      <div className="relative mt-2 h-14">
        <svg role="img" aria-label={label} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <polygon points={`${pts(median)} ${x(median.at(-1)!.x).toFixed(2)},${floor.toFixed(2)} ${x(0).toFixed(2)},${floor.toFixed(2)}`} style={{ fill: MEDIAN_FILL }} />
          <polyline points={pts(median)} fill="none" stroke="var(--color-ink-3)" strokeOpacity="0.55" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <line x1={0} x2={VIEW_W} y1={floor} y2={floor} stroke="var(--color-line-strong)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {curve.solid.length > 1 ? <polyline points={pts(curve.solid)} fill="none" stroke="var(--color-brand)" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
          {curve.partial ? <polyline points={pts(curve.partial)} fill="none" stroke="var(--color-brand)" strokeWidth="2.25" strokeDasharray="4 3" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        <span
          aria-hidden
          className={`absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand ${curve.endsEarly ? "bg-surface" : "bg-brand"}`}
          style={{ left: `${(x(curve.end.x) / VIEW_W) * 100}%`, top: `${(y(curve.end.y) / VIEW_H) * 100}%` }}
        />
      </div>
      <p className="num mt-1.5 text-[13px] leading-tight">
        <span className="font-semibold">{count(card.totalUnits)}</span>
        <span className="muted">{` ${card.totalUnits === 1 ? "unit" : "units"} in ${card.daysObserved} days${card.fullyObserved ? "" : " so far"}`}</span>
      </p>
    </figure>
  );
}
