"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { AnnotationLegend, AnnotationList, AnnotationMarkers, type PlacedMarker } from "@/components/pace/pace-annotations";
import { ANNOTATION_KINDS, type AnnotationKind, type PaceAnnotation } from "@/lib/pace/annotation-types";
import { formatUnit, monthName } from "@/lib/pace/format";
import { layoutMarkers } from "@/lib/pace/markers";
import type { PaceSeries } from "@/lib/pace/series";

// Cumulative net sales by day against the plan. Solid brand colour is what happened, grey is the plan, the dashed brand-colour run to the
// month's end is the estimate (never solid), the dotted line is the target. Drawn in plain SVG at the width it is given, so
// the type stays readable on a phone. The same figures are in the aria-label and in the "Show the numbers" table.
// Beside it, optionally: markers under the day axis for what explains the month (calendar entries, call notes, new discount codes,
// possible stockouts), and a slot under the chart for the scrubber. A series cut at an earlier day draws as the month stood then;
// `scale` keeps the y axis where today's view puts it, so the lines don't jump about as the scrubber moves.

// The ahead and behind words in the dark hover card: the scheme's own green and red, lightened toward the card's text colour so they read on it.
const AHEAD_ON_INVERSE = "text-[color:color-mix(in_oklab,var(--color-ahead)_50%,var(--color-on-inverse))]";
const BEHIND_ON_INVERSE = "text-[color:color-mix(in_oklab,var(--color-behind)_50%,var(--color-on-inverse))]";

// The top of the y axis: a round number, so four even steps give round ticks (1, 1.2, 1.5, 2, 2.5, 3, 4, 5 or 10 times a power of ten).
function niceMax(v: number): number {
  const raw = v / 4;
  if (!(raw > 0)) return 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 10]) if (m * mag >= raw) return m * mag * 4;
  return raw * 4;
}

const shortDate = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const longDate = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// What the chart tells the slot under it: where the days sit, so a control there can line up with them.
export interface PlotGeometry {
  width: number; // the chart's width
  x: (day: number) => number; // a 1-based day to its x
  left: number; // where day 1 sits
  right: number; // the right end of the plot
}

const MARKER_ROW = 22;

export function PaceChart({
  series,
  currency,
  compact = false,
  annotations = [],
  scale,
  replay = false,
  underChart,
}: {
  series: PaceSeries;
  currency: string;
  compact?: boolean;
  annotations?: readonly PaceAnnotation[];
  scale?: PaceSeries; // the series whose figures set the y axis (today's view, while `series` is an earlier one)
  replay?: boolean; // `series` is cut at an earlier day than the last complete one
  underChart?: (plot: PlotGeometry) => ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  const [off, setOff] = useState<AnnotationKind[]>([]); // kinds switched off in the legend
  const [guide, setGuide] = useState<string | null>(null); // the date of the marker being pointed at or focused

  // Draw at the width the card gives it. The observer reports once when it starts, so the first size arrives without a separate read.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.max(240, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const money = (cents: number) => formatUnit("money", cents, currency);
  const days = series.days;
  const N = days.length;
  const throughIdx = Math.max(0, days.findIndex((d) => d.date === series.through)); // 0-based index of the last complete day
  const D = throughIdx + 1;
  const hasEstimate = series.projected !== null && D < N;
  const full = scale ?? series;

  // The markers that fall on a day of this month, on the day's position. The rows are worked out for all of them, so switching a
  // kind off in the legend never moves the chart.
  const dayNumber = useMemo(() => new Map(full.days.map((d, i) => [d.date, i + 1])), [full]);
  const annos = useMemo(() => (compact ? [] : annotations.filter((a) => dayNumber.has(a.date))), [annotations, compact, dayNumber]);

  const geo = useMemo(() => {
    const narrow = width < 480;
    const fs = compact ? 13 : 12;
    const baseH = compact ? (narrow ? 170 : 190) : narrow ? 240 : 300;
    const pt = 16;
    const pr = compact ? 16 : 20;
    const basePb = compact ? 30 : 28;
    const top = niceMax(Math.max(full.target, full.projected ?? 0, full.actualThrough, full.planThrough) * 1.04);
    const step = top / 4;
    const bigNumbers = top >= 10_000_000; // $100,000 and up: $25K, $1.2M
    const digits = Number.isInteger(step / 100) ? 0 : 2;
    const fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: bigNumbers ? "compact" : "standard",
      minimumFractionDigits: bigNumbers ? 0 : digits,
      maximumFractionDigits: bigNumbers ? 1 : digits,
    });
    const ticks = [0, 1, 2, 3, 4].map((i) => ({ v: step * i, label: fmt.format((step * i) / 100) }));
    const longest = Math.max(...ticks.map((t) => t.label.length));
    const pl = Math.round(longest * fs * 0.6 + 16);
    const x = (d: number) => pl + (N > 1 ? ((d - 1) / (N - 1)) * (width - pl - pr) : 0);
    const lay = annos.length > 0 ? layoutMarkers(annos.map((a) => x(dayNumber.get(a.date)!)), MARKER_ROW) : null;
    const lane = lay ? lay.rowCount * MARKER_ROW + 6 : 0; // room for the markers between the axis line and its date labels
    const H = baseH + lane;
    const pb = basePb + lane;
    const y = (v: number) => pt + (1 - v / top) * (H - pt - pb);
    return { fs, H, pt, pr, pb, pl, top, ticks, x, y, rows: lay?.rows ?? [] };
  }, [width, compact, currency, N, full.target, full.projected, full.actualThrough, full.planThrough, annos, dayNumber]);
  const { fs, H, pt, pr, pb, pl, ticks, x, y } = geo;

  const line = (pts: { d: number; v: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const actualPts = days.slice(0, D).map((d, i) => ({ d: i + 1, v: d.actual ?? 0 }));
  const planPts = days.map((d, i) => ({ d: i + 1, v: d.plan }));
  const actualPath = line(actualPts);
  const areaPath = `${actualPath} L${x(D).toFixed(1)} ${y(0).toFixed(1)} L${x(1).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const planPath = line(planPts);

  const xTickDays = (width < 340 ? [1, 15, N] : [1, 8, 15, 22, N]).filter((d, i, a) => d <= N && a.indexOf(d) === i && (d !== 22 || N - 22 >= 5));
  const tgtY = y(series.target);
  const lastY = y(series.actualThrough);
  const ahead = series.actualThrough >= series.planThrough;
  const throughLabel = longDate(series.through);

  const ariaLabel = `Cumulative net sales by day in ${monthName(series.month)} against plan. Actual ${money(series.actualThrough)} through ${throughLabel}, plan so far ${money(series.planThrough)}${
    series.projected !== null ? `, month-end estimate about ${money(series.projected)}` : ""
  }, target ${money(series.target)}.${replay ? ` Showing the month as it stood on ${throughLabel}.` : ""}${
    annos.length > 0 ? ` ${annos.length} ${annos.length === 1 ? "marker" : "markers"} on the timeline, listed under Show the numbers.` : ""
  }`;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (r.width <= 0) return;
    const px = ((e.clientX - r.left) / r.width) * width;
    const d = Math.round(((px - pl) / (width - pl - pr)) * (N - 1)) + 1;
    setHover(clamp(d, 1, N));
  };

  const baseline = H - pb;
  const markers: PlacedMarker[] = annos.flatMap((a, i) =>
    off.includes(a.kind) ? [] : [{ a, x: x(dayNumber.get(a.date)!), y: baseline + 14 + geo.rows[i]! * MARKER_ROW, dim: replay && a.date > series.through }],
  );
  const counts = Object.fromEntries(ANNOTATION_KINDS.map((k) => [k, annos.filter((a) => a.kind === k).length])) as Record<AnnotationKind, number>;
  const guideDay = guide !== null ? dayNumber.get(guide) : undefined;

  const hd = hover !== null && guide === null ? days[hover - 1] : undefined;
  const hx = hover !== null ? x(hover) : 0;
  const hActual = hd?.actual ?? null;
  const hGap = hd && hActual !== null ? hActual - hd.plan : null;
  const hTop = hd ? y(Math.max(hActual ?? 0, hd.plan)) : 0;
  const tipBelow = hTop < 110;

  return (
    <div>
      <div ref={wrapRef} className="relative w-full min-w-0 overflow-x-clip">
        <svg ref={svgRef} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={ariaLabel} className="block h-auto w-full">
          {ticks.map((t) => (
            <g key={t.v}>
              <line x1={pl} x2={width - pr} y1={y(t.v)} y2={y(t.v)} className="stroke-line" />
              <text x={pl - 10} y={y(t.v) + 4} textAnchor="end" fontSize={fs} className="fill-ink-3">
                {t.label}
              </text>
            </g>
          ))}
          {xTickDays.map((d) => (
            <text key={d} x={x(d)} y={H - 8} textAnchor={d === N ? "end" : d === 1 ? "start" : "middle"} fontSize={fs} className="fill-ink-3">
              {shortDate(days[d - 1]!.date)}
            </text>
          ))}

          {guideDay !== undefined ? <line x1={x(guideDay)} x2={x(guideDay)} y1={pt} y2={baseline + 4} className="stroke-ink" strokeOpacity={0.28} strokeDasharray="3 3" aria-hidden /> : null}

          <line x1={pl} x2={width - pr} y1={tgtY} y2={tgtY} className="stroke-ink-2" strokeWidth={1.5} strokeDasharray="1.5 4" strokeLinecap="round" />
          <text x={pl + 6} y={tgtY - 7} fontSize={fs} fontWeight={600} className="fill-ink-2">
            Target {money(series.target)}
          </text>

          <path d={areaPath} className="fill-brand" fillOpacity={0.09} />
          <path d={planPath} fill="none" className="stroke-plan" strokeWidth={2.2} strokeLinejoin="round" />
          <path d={actualPath} fill="none" className="stroke-brand" strokeWidth={2.8} strokeLinejoin="round" strokeLinecap="round" />
          {hasEstimate ? (
            <>
              <path d={`M${x(D).toFixed(1)} ${lastY.toFixed(1)} L${x(N).toFixed(1)} ${y(series.projected!).toFixed(1)}`} fill="none" className="stroke-brand" strokeWidth={2.8} strokeDasharray="2 6" strokeLinecap="round" />
              <circle cx={x(N)} cy={y(series.projected!)} r={4.5} className="fill-surface stroke-brand" strokeWidth={2.2} strokeDasharray="2 2" />
            </>
          ) : null}
          <circle cx={x(D)} cy={lastY} r={5} className="fill-surface stroke-brand" strokeWidth={2.5} />
          <text
            x={x(D) - 8}
            y={clamp(lastY + (ahead ? -12 : 20), pt + fs, H - pb - 4)}
            textAnchor="end"
            fontSize={fs + 0.5}
            fontWeight={650}
            className="fill-brand-strong stroke-surface"
            strokeWidth={3}
            strokeLinejoin="round"
            style={{ paintOrder: "stroke" }}
          >
            {money(series.actualThrough)}
          </text>

          {!compact && hd ? (
            <g aria-hidden>
              <line x1={hx} x2={hx} y1={pt} y2={H - pb} className="stroke-ink" strokeOpacity={0.35} />
              {hActual !== null ? <circle cx={hx} cy={y(hActual)} r={4.5} className="fill-brand" /> : null}
              <circle cx={hx} cy={y(hd.plan)} r={4} className="fill-plan" />
            </g>
          ) : null}
          {!compact ? (
            <rect
              x={pl}
              y={pt}
              width={Math.max(0, width - pl - pr)}
              height={H - pt - pb}
              fill="transparent"
              style={{ touchAction: "pan-y" }}
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setHover(null)}
              onPointerCancel={() => setHover(null)}
            />
          ) : null}
        </svg>

        {!compact && hd ? (
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 rounded-[10px] bg-inverse px-3 py-2 text-[12.5px] leading-[1.45] whitespace-nowrap text-on-inverse shadow-pop"
            style={{ left: clamp(hx, 78, Math.max(78, width - 78)), top: hTop, transform: tipBelow ? "translate(-50%, 14px)" : "translate(-50%, calc(-100% - 12px))" }}
          >
            <div>{shortDate(hd.date)}</div>
            {hActual !== null ? (
              <div>
                Actual <b className="num font-semibold">{money(hActual)}</b>
              </div>
            ) : null}
            <div>
              Plan <b className="num font-semibold">{money(hd.plan)}</b>
            </div>
            {hGap !== null ? (
              <div className={hGap >= 0 ? AHEAD_ON_INVERSE : BEHIND_ON_INVERSE}>{hGap === 0 ? "On plan" : `${money(Math.abs(hGap))} ${hGap > 0 ? "ahead" : "behind"}`}</div>
            ) : (
              <div className="text-on-inverse/70">{replay ? "After the day shown" : "Not complete yet"}</div>
            )}
          </div>
        ) : null}
        {markers.length > 0 ? <AnnotationMarkers markers={markers} width={width} height={H} onGuide={setGuide} /> : null}
      </div>

      {!compact && underChart ? underChart({ width, x, left: pl, right: width - pr }) : null}

      {!compact ? (
        <>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink-2">
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block w-5 border-t-[3px] border-brand" />
              Actual
            </li>
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block w-5 border-t-[3px] border-plan" />
              Plan ({series.spread === "last_year" ? "last year's daily pattern" : "spread evenly"})
            </li>
            {hasEstimate ? (
              <li className="inline-flex items-center gap-2">
                <span aria-hidden className="inline-block w-5 border-t-[3px] border-dashed border-brand" />
                Estimate to month end
              </li>
            ) : null}
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block w-5 border-t-2 border-dotted border-ink-2" />
              Target
            </li>
          </ul>
          <AnnotationLegend counts={counts} off={off} onToggle={(k) => setOff((cur) => (cur.includes(k) ? cur.filter((o) => o !== k) : [...cur, k]))} />
          <details className="mt-3 text-sm">
            <summary className="muted w-fit cursor-pointer rounded-md py-1 font-medium hover:text-ink">Show the numbers</summary>
            <AnnotationList annotations={annos} />
            <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-line">
              <table className="data-table">
                <caption className="sr-only">Cumulative net sales and plan by day in {monthName(series.month)}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="num">Actual</th>
                    <th scope="col" className="num">Plan</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((d) => (
                    <tr key={d.date}>
                      <th scope="row" className="font-normal">{shortDate(d.date)}</th>
                      <td className="num">{d.actual !== null ? money(d.actual) : replay ? "After the day shown" : "Not complete yet"}</td>
                      <td className="num">{money(d.plan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
