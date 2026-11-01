"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { formatUnit, monthName } from "@/lib/pace/format";
import type { PaceSeries } from "@/lib/pace/series";

// Cumulative net sales by day against the plan. Solid teal is what happened, grey is the plan, the dashed teal run to the
// month's end is the estimate (never solid), the dotted line is the target. Drawn in plain SVG at the width it is given, so
// the type stays readable on a phone. The same figures are in the aria-label and in the "Show the numbers" table.

const PLAN_GREY = "#9fb1ae";

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

export function PaceChart({ series, currency, compact = false }: { series: PaceSeries; currency: string; compact?: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

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

  const geo = useMemo(() => {
    const narrow = width < 480;
    const fs = compact ? 13 : 12;
    const H = compact ? (narrow ? 170 : 190) : narrow ? 240 : 300;
    const pt = 16;
    const pr = compact ? 16 : 20;
    const pb = compact ? 30 : 28;
    const top = niceMax(Math.max(series.target, series.projected ?? 0, series.actualThrough, series.planThrough) * 1.04);
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
    const y = (v: number) => pt + (1 - v / top) * (H - pt - pb);
    return { fs, H, pt, pr, pb, pl, top, ticks, x, y };
  }, [width, compact, currency, N, series.target, series.projected, series.actualThrough, series.planThrough]);
  const { fs, H, pt, pr, pb, pl, ticks, x, y } = geo;

  const line = (pts: { d: number; v: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.d).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const actualPts = days.slice(0, D).map((d, i) => ({ d: i + 1, v: d.actual ?? 0 }));
  const planPts = days.map((d, i) => ({ d: i + 1, v: d.plan }));
  const actualPath = line(actualPts);
  const areaPath = `${actualPath} L${x(D).toFixed(1)} ${y(0).toFixed(1)} L${x(1).toFixed(1)} ${y(0).toFixed(1)} Z`;
  const planPath = line(planPts);

  const xTickDays = [1, 8, 15, 22, N].filter((d, i, a) => d <= N && a.indexOf(d) === i && (d !== 22 || N - 22 >= 5));
  const tgtY = y(series.target);
  const lastY = y(series.actualThrough);
  const ahead = series.actualThrough >= series.planThrough;
  const throughLabel = longDate(series.through);

  const ariaLabel = `Cumulative net sales by day in ${monthName(series.month)} against plan. Actual ${money(series.actualThrough)} through ${throughLabel}, plan so far ${money(series.planThrough)}${
    series.projected !== null ? `, month-end estimate about ${money(series.projected)}` : ""
  }, target ${money(series.target)}.`;

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    if (r.width <= 0) return;
    const px = ((e.clientX - r.left) / r.width) * width;
    const d = Math.round(((px - pl) / (width - pl - pr)) * (N - 1)) + 1;
    setHover(clamp(d, 1, N));
  };

  const hd = hover !== null ? days[hover - 1] : undefined;
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

          <line x1={pl} x2={width - pr} y1={tgtY} y2={tgtY} className="stroke-ink-2" strokeWidth={1.5} strokeDasharray="1.5 4" strokeLinecap="round" />
          <text x={pl + 6} y={tgtY - 7} fontSize={fs} fontWeight={600} className="fill-ink-2">
            Target {money(series.target)}
          </text>

          <path d={areaPath} className="fill-brand" fillOpacity={0.09} />
          <path d={planPath} fill="none" stroke={PLAN_GREY} strokeWidth={2.2} strokeLinejoin="round" />
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
              <circle cx={hx} cy={y(hd.plan)} r={4} fill={PLAN_GREY} />
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
              <div className={hGap >= 0 ? "text-[#86efac]" : "text-[#fdba9f]"}>{hGap === 0 ? "On plan" : `${money(Math.abs(hGap))} ${hGap > 0 ? "ahead" : "behind"}`}</div>
            ) : (
              <div className="text-on-inverse/70">Not complete yet</div>
            )}
          </div>
        ) : null}
      </div>

      {!compact ? (
        <>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink-2">
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block w-5 border-t-[3px] border-brand" />
              Actual
            </li>
            <li className="inline-flex items-center gap-2">
              <span aria-hidden className="inline-block w-5 border-t-[3px]" style={{ borderColor: PLAN_GREY }} />
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
          <details className="mt-3 text-sm">
            <summary className="muted w-fit cursor-pointer rounded-md py-1 font-medium hover:text-ink">Show the numbers</summary>
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
                      <td className="num">{d.actual !== null ? money(d.actual) : "Not complete yet"}</td>
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
