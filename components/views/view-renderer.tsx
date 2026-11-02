import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { PaceTrack } from "@/components/pace/pace-track";
import { formatGap, formatMove, formatRange, formatUnit } from "@/lib/pace/format";
import type { CohortRow, GaugeItem, KpiCard, ViewData } from "@/lib/views/types";
import { BundleMatrix } from "./bundle-matrix";
import { LaunchCurves } from "./launch-curves";
import { LiftDip } from "./lift-dip";

// The ten components a chat answer can draw (the last three each have a file of their own). Each is plain server-safe markup (no chart library), with a label that gives
// the figures to a screen reader and a table of the numbers behind every chart. Every figure comes from `data`, which the
// server built from tool results; store text (a product title) is only ever rendered as text.

const TONE = { ahead: "text-ahead", behind: "text-behind", even: "muted" } as const;
const TONE_ICON = { ahead: ArrowUpRight, behind: ArrowDownRight, even: Minus } as const;

// Chart colours (SVG attributes cannot use the Tailwind tokens, so these repeat them).
// CSS variables, so the charts follow the light and dark theme.
const C = { brand: "var(--color-brand)", ink: "var(--color-ink)", axis: "var(--color-estimate)", line: "var(--color-line)", lineStrong: "var(--color-line-strong)", ahead: "var(--color-ahead)", behind: "var(--color-behind)" } as const;

const asOfText = (iso: string) => {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(d);
  return `${date}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
};

function Frame({ title, data, children }: { title: string; data: ViewData; children: ReactNode }) {
  return (
    <figure className="card overflow-hidden">
      <div className="px-5 pt-4 pb-3 sm:px-6">
        <figcaption className="section-title">{title}</figcaption>
        <p className="muted mt-0.5 text-[13px]">{`${formatRange(data.range.from, data.range.to)} · as of ${asOfText(data.asOf)}`}</p>
      </div>
      <div className="px-5 pb-5 sm:px-6">{children}</div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-3 sm:px-6">
        <span className="muted text-xs">Source</span>
        {data.queryIds.map((id) => (
          <span key={id} className="badge font-mono text-[11px]">
            {id}
          </span>
        ))}
      </div>
    </figure>
  );
}

function Numbers({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <details className="group mt-4">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-[13px] font-medium text-brand-strong marker:content-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
        Show the numbers
      </summary>
      <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-line">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">{head[0]}</th>
              <th scope="col" className="num">{head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([a, b], i) => (
              <tr key={i}>
                <td>{a}</td>
                <td className="num">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Kpi({ card, currency, showPeriod }: { card: KpiCard; currency: string; showPeriod: boolean }) {
  const move = formatMove(card.pctChange);
  const plan = card.plan ? formatGap(card.metric, card.plan.gap, currency) : null;
  const PlanIcon = plan ? TONE_ICON[plan.tone] : null;
  const MoveIcon = card.pctChange && card.pctChange < 0 ? ArrowDownRight : card.pctChange && card.pctChange > 0 ? ArrowUpRight : Minus;
  return (
    <div className="inset p-4">
      <p className="text-sm font-medium muted">{card.label}</p>
      {showPeriod ? <p className="muted text-xs">{formatRange(card.range.from, card.range.to)}</p> : null}
      <p className="stat num mt-2 text-3xl">{formatUnit(card.unit, card.value, currency)}</p>
      {card.previous !== undefined ? (
        <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm muted">
          {move ? (
            <>
              <span className="badge">
                <MoveIcon className="size-3.5" aria-hidden />
                {move}
              </span>
              <span className="num">{`from ${formatUnit(card.unit, card.previous, currency)}`}</span>
            </>
          ) : (
            <span className="num">{`compared with ${formatUnit(card.unit, card.previous, currency)}`}</span>
          )}
        </p>
      ) : null}
      {plan && PlanIcon ? (
        <p className={`mt-2 flex items-center gap-1.5 text-sm font-medium ${TONE[plan.tone]}`}>
          <PlanIcon className="size-3.5 shrink-0" aria-hidden />
          {plan.text}
        </p>
      ) : null}
    </div>
  );
}

function Line({ data, currency }: { data: Extract<ViewData, { component: "line" }>; currency: string }) {
  const { points } = data;
  const W = 560;
  const H = 230;
  const pad = { l: 66, r: 14, t: 14, b: 30 };
  const ys = points.map((p) => p.y);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(...ys, lo + 1);
  const x = (i: number) => (points.length === 1 ? (pad.l + W - pad.r) / 2 : pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const fmt = (v: number) => formatUnit(data.unit, v, currency);
  const label = `${data.label} by ${data.dimension}, ${points.length} points from ${points[0]?.x} to ${points.at(-1)?.x}, from ${fmt(Math.min(...ys))} to ${fmt(Math.max(...ys))}`;
  const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  const xy = points.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`);
  const baseline = y(lo);
  const lastIndex = points.length - 1;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={C.line} strokeWidth="1" />
            <text x={pad.l - 8} y={y(t) + 4} fontSize="12" fill={C.axis} textAnchor="end">{fmt(t)}</text>
          </g>
        ))}
        {lo < 0 ? <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke={C.ink} strokeWidth="1.5" /> : null}
        {points.length > 1 ? <polygon points={`${x(0).toFixed(1)},${baseline.toFixed(1)} ${xy.join(" ")} ${x(lastIndex).toFixed(1)},${baseline.toFixed(1)}`} fill={C.brand} fillOpacity="0.1" /> : null}
        <polyline fill="none" stroke={C.brand} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" points={xy.join(" ")} />
        {points.length <= 40
          ? points.slice(0, -1).map((p, i) => <circle key={i} cx={x(i)} cy={y(p.y)} r="2.5" fill={C.brand} />)
          : null}
        {points.length > 0 ? <circle cx={x(lastIndex)} cy={y(points[lastIndex]!.y)} r="4.5" fill={C.brand} stroke="var(--color-surface)" strokeWidth="2" /> : null}
        {points.map((p, i) => (
          <circle key={`hit-${i}`} cx={x(i)} cy={y(p.y)} r="9" fill="transparent">
            <title>{`${p.x}: ${fmt(p.y)}`}</title>
          </circle>
        ))}
        <text x={pad.l} y={H - 8} fontSize="12" fill={C.axis}>{points[0]?.x}</text>
        <text x={W - pad.r} y={H - 8} fontSize="12" fill={C.axis} textAnchor="end">{points.at(-1)?.x}</text>
      </svg>
      <Numbers head={[data.dimension, data.label]} rows={points.map((p) => [p.x, fmt(p.y)])} />
    </>
  );
}

function Bars({ data, currency }: { data: Extract<ViewData, { component: "bar" }>; currency: string }) {
  const max = Math.max(...data.bars.map((b) => b.value), 0);
  return (
    <>
      <ul className="space-y-3.5">
        {data.bars.map((b, i) => (
          <li key={i} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate" title={b.label}>{b.label}</span>
              <span className="num shrink-0 text-right">
                <span className="font-medium">{formatUnit(data.unit, b.value, currency)}</span>
                {b.share !== undefined ? <span className="muted ml-2 text-[13px]">{`${(b.share * 100).toFixed(1)}%`}</span> : null}
              </span>
            </div>
            <div className="mt-1.5 h-2.5 rounded-full bg-paper-2">
              <div className="h-full rounded-full bg-brand" style={{ width: `${max > 0 ? Math.round((b.value / max) * 1000) / 10 : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {data.truncated ? <p className="muted mt-3 text-[13px]">{`Showing ${data.truncated.shown} of ${data.truncated.total}.`}</p> : null}
    </>
  );
}

function Table({ data, currency }: { data: Extract<ViewData, { component: "table" }>; currency: string }) {
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="data-table">
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c.key} scope="col" className={c.unit ? "num" : undefined}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i}>
                {data.columns.map((c) => {
                  const v = r[c.key];
                  return (
                    <td key={c.key} className={c.unit ? "num" : undefined}>
                      {v === null || v === undefined ? "—" : typeof v === "number" && c.unit ? formatUnit(c.unit, v, currency) : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.rows.length === 0 ? <p className="muted mt-3 text-sm">No rows for this period.</p> : null}
      {data.truncated ? <p className="muted mt-3 text-[13px]">{`Showing ${data.truncated.shown} of ${data.truncated.total}.`}</p> : null}
    </>
  );
}

function Gauge({ g, currency }: { g: GaugeItem; currency: string }) {
  const money = (v: number) => formatUnit(g.unit, v, currency);
  const gap = formatGap(g.metric, g.actual - g.planned, currency);
  const Icon = TONE_ICON[gap.tone];
  return (
    <div className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="text-sm font-medium muted">{g.label}</p>
        <span className={`badge ${gap.tone === "ahead" ? "badge-ahead" : gap.tone === "behind" ? "badge-behind" : ""} text-[13px]`}>
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {gap.text}
        </span>
      </div>
      <p className="stat num mt-1 text-3xl">{money(g.actual)}</p>
      <div className="mt-3">
        <PaceTrack label={g.label} actual={g.actual} planned={g.planned} target={g.target} projected={g.projected} money={money} />
      </div>
    </div>
  );
}

const monthLabel = (month: string) => new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

// The cohort heat-grid: a row for each month of first orders, a column for each 30-day month after, a cell shaded by the share
// of that cohort who ordered again by then (the share is cumulative, so a row can only get darker).
function Cohort({ data }: { data: Extract<ViewData, { component: "cohort" }> }) {
  const shares = data.rows.flatMap((r) => r.cells.map((c) => c.repeatShare).filter((x): x is number => x !== null));
  const max = Math.max(...shares, 0);
  const shade = (share: number) => `color-mix(in oklab, var(--color-brand) ${(max > 0 ? Math.min(share / max, 1) * 55 : 0).toFixed(0)}%, transparent)`;
  const columns = data.windowMonths;
  const label = `Repeat rate by first-order month and months since the first order${data.firstOrderCode ? `, first orders with ${data.firstOrderCode}` : ""}: ${data.rows.length} cohorts, ${data.rows[0]?.cohort} to ${data.rows.at(-1)?.cohort}${max > 0 ? `, up to ${percent(max)}` : ""}`;
  const cellWords = (c: CohortRow["cells"][number]) => (c.repeatShare === null ? "not enough time has passed" : `${percent(c.repeatShare)} of ${c.customers}`);
  return (
    <>
      <div className="overflow-x-auto">
        <div role="img" aria-label={label} className="grid min-w-max gap-1" style={{ gridTemplateColumns: `6rem repeat(${columns.length}, minmax(4.25rem, 1fr))` }}>
          <div aria-hidden className="muted px-1 text-xs">First order</div>
          {columns.map((k) => (
            <div key={k} aria-hidden className="muted px-1 text-center text-xs">{`${k} ${k === 1 ? "month" : "months"}`}</div>
          ))}
          {data.rows.flatMap((r) => [
            <div key={`${r.cohort}-h`} aria-hidden className="flex flex-col justify-center px-1 text-[13px]">
              <span className="font-medium">{monthLabel(r.cohort)}</span>
              <span className="muted text-[11px]">{`${r.cohortCustomers} customers`}</span>
            </div>,
            ...columns.map((k) => {
              const c = r.cells.find((x) => x.monthsSince === k);
              return (
                <div
                  key={`${r.cohort}-${k}`}
                  aria-hidden
                  title={`${monthLabel(r.cohort)}, within ${k * 30} days: ${c ? cellWords(c) : "no data"}`}
                  className="num flex min-h-11 flex-col items-center justify-center rounded-md border border-line text-[13px] font-medium"
                  style={c && c.repeatShare !== null ? { backgroundColor: shade(c.repeatShare) } : undefined}
                >
                  {c && c.repeatShare !== null ? (
                    <>
                      <span>{percent(c.repeatShare)}</span>
                      <span className="muted text-[10.5px] font-normal">{`of ${c.customers}`}</span>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              );
            }),
          ])}
        </div>
      </div>
      <p className="muted mt-3 text-[13px]">A month here is 30 days. Each cell is the share of that month&apos;s new customers who ordered again within that time; a dash means nobody in the cohort has been a customer that long yet.</p>
      <details className="group mt-4">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-[13px] font-medium text-brand-strong marker:content-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />
          Show the numbers
        </summary>
        <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-line">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">First order</th>
                <th scope="col" className="num">Customers</th>
                {columns.map((k) => (
                  <th key={k} scope="col" className="num">{`${k * 30} days`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.cohort}>
                  <td>{monthLabel(r.cohort)}</td>
                  <td className="num">{r.cohortCustomers}</td>
                  {columns.map((k) => {
                    const c = r.cells.find((x) => x.monthsSince === k);
                    return (
                      <td key={k} className="num">
                        {c && c.repeatShare !== null ? `${percent(c.repeatShare)} of ${c.customers}` : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function Waterfall({ data, currency }: { data: Extract<ViewData, { component: "waterfall" }>; currency: string }) {
  const W = 560;
  const H = 240;
  const pad = { t: 24, b: 44, l: 6, r: 6 };
  const bars: { label: string; from: number; to: number; kind: "start" | "delta" | "end"; value: number }[] = [];
  let running = 0;
  for (const s of data.steps) {
    if (s.kind === "delta") {
      bars.push({ label: s.label, from: running, to: running + s.value, kind: s.kind, value: s.value });
      running += s.value;
    } else {
      bars.push({ label: s.label, from: 0, to: s.value, kind: s.kind, value: s.value });
      if (s.kind === "start") running = s.value;
    }
  }
  const all = bars.flatMap((b) => [b.from, b.to]);
  const lo = Math.min(0, ...all);
  const hi = Math.max(...all, lo + 1);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / bars.length;
  const money = (v: number) => formatUnit(data.unit, v, currency);
  const color = (b: (typeof bars)[number]) => (b.kind !== "delta" ? C.ink : b.value >= 0 ? C.ahead : C.behind);
  const words = (b: (typeof bars)[number]) => (b.kind !== "delta" ? money(b.value) : b.value === 0 ? "no change" : `${b.value > 0 ? "up" : "down"} ${money(Math.abs(b.value))}`);
  const first = data.steps[0]!;
  const last = data.steps.at(-1)!;
  const label = `${data.label} by ${data.dimension}: from ${money(first.value)} to ${money(last.value)} through ${bars.filter((b) => b.kind === "delta").length} changes`;
  const barX = (i: number) => pad.l + i * slot + slot * 0.2;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke={C.lineStrong} strokeWidth="1" />
        {bars.slice(0, -1).map((b, i) => (
          <line key={`c-${i}`} x1={barX(i) + slot * 0.6} x2={barX(i + 1)} y1={y(b.to)} y2={y(b.to)} stroke={C.axis} strokeWidth="1" />
        ))}
        {bars.map((b, i) => {
          const top = y(Math.max(b.from, b.to));
          const height = Math.max(1, Math.abs(y(b.from) - y(b.to)));
          const x = barX(i);
          return (
            <g key={i}>
              <rect x={x} y={top} width={slot * 0.6} height={height} rx="3" fill={color(b)} />
              <text x={x + slot * 0.3} y={top - 6} textAnchor="middle" fontSize="12" fontWeight="600" fill={C.ink} aria-hidden="true">
                {b.kind === "delta" ? `${b.value >= 0 ? "▲" : "▼"} ${money(Math.abs(b.value))}` : money(b.value)}
              </text>
              <text x={x + slot * 0.3} y={H - 20} textAnchor="middle" fontSize="12" fill={C.axis}>{b.label.length > 16 ? `${b.label.slice(0, 15)}…` : b.label}</text>
            </g>
          );
        })}
      </svg>
      <Numbers head={["Step", data.label]} rows={bars.map((b) => [b.label, words(b)])} />
    </>
  );
}

export function ViewRenderer({ data, title, currency }: { data: ViewData; title: string; currency: string }) {
  switch (data.component) {
    case "kpi":
      return (
        <Frame title={title} data={data}>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.cards.map((c, i) => (
              <Kpi key={`${i}-${c.metric}`} card={c} currency={currency} showPeriod={new Set(data.cards.map((x) => `${x.range.from}${x.range.to}`)).size > 1} />
            ))}
          </div>
        </Frame>
      );
    case "gauge":
      return (
        <Frame title={title} data={data}>
          <div className="divide-y divide-line">
            {data.gauges.map((g) => (
              <Gauge key={g.metric} g={g} currency={currency} />
            ))}
          </div>
          <p className="muted mt-4 text-[13px]">{`Complete days through ${formatRange(data.gauges[0]!.throughDate, data.gauges[0]!.throughDate)}. The tick is the plan so far, the line is the month's target, and the hatched part is an estimate of where the month lands.`}</p>
        </Frame>
      );
    case "line":
      return (
        <Frame title={title} data={data}>
          <Line data={data} currency={currency} />
        </Frame>
      );
    case "bar":
      return (
        <Frame title={title} data={data}>
          <Bars data={data} currency={currency} />
        </Frame>
      );
    case "table":
      return (
        <Frame title={title} data={data}>
          <Table data={data} currency={currency} />
        </Frame>
      );
    case "waterfall":
      return (
        <Frame title={title} data={data}>
          <Waterfall data={data} currency={currency} />
        </Frame>
      );
    case "cohort":
      return (
        <Frame title={title} data={data}>
          <Cohort data={data} />
        </Frame>
      );
    case "lift_dip":
      return (
        <Frame title={title} data={data}>
          <LiftDip data={data} currency={currency} />
        </Frame>
      );
    case "launch_curves":
      return (
        <Frame title={title} data={data}>
          <LaunchCurves data={data} />
        </Frame>
      );
    case "bundle_matrix":
      return (
        <Frame title={title} data={data}>
          <BundleMatrix data={data} />
        </Frame>
      );
  }
}
