import type { ReactNode } from "react";
import { formatGap, formatMove, formatRange, formatUnit } from "@/lib/pace/format";
import type { GaugeItem, KpiCard, ViewData } from "@/lib/views/types";

// The six components a chat answer can draw. Each is plain server-safe markup (no chart library), with a label that gives
// the figures to a screen reader and a table of the numbers behind every chart. Every figure comes from `data`, which the
// server built from tool results; store text (a product title) is only ever rendered as text.

const TONE = { ahead: "text-emerald-700", behind: "text-rose-700", even: "text-neutral-600" } as const;

const asOfText = (iso: string) => {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(d);
  return `${date}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
};

function Frame({ title, data, children }: { title: string; data: ViewData; children: ReactNode }) {
  return (
    <figure className="rounded-lg border border-neutral-200 bg-white p-4">
      <figcaption className="font-medium">{title}</figcaption>
      <p className="text-xs text-neutral-500">{`${formatRange(data.range.from, data.range.to)} · as of ${asOfText(data.asOf)}`}</p>
      <div className="mt-3">{children}</div>
      <p className="mt-3 text-xs text-neutral-400">{`Source: ${data.queryIds.join(", ")}`}</p>
    </figure>
  );
}

function Numbers({ head, rows }: { head: [string, string]; rows: [string, string][] }) {
  return (
    <details className="mt-3 text-xs text-neutral-600">
      <summary className="cursor-pointer">Show the numbers</summary>
      <table className="mt-2 w-full">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="font-normal">{head[0]}</th>
            <th className="font-normal">{head[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([a, b], i) => (
            <tr key={i} className="border-t border-neutral-100">
              <td className="py-0.5">{a}</td>
              <td className="py-0.5">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function Kpi({ card, currency, showPeriod }: { card: KpiCard; currency: string; showPeriod: boolean }) {
  const move = formatMove(card.pctChange);
  const plan = card.plan ? formatGap(card.metric, card.plan.gap, currency) : null;
  return (
    <div className="rounded-md border border-neutral-100 p-3">
      <p className="text-sm text-neutral-600">{card.label}</p>
      {showPeriod ? <p className="text-xs text-neutral-500">{formatRange(card.range.from, card.range.to)}</p> : null}
      <p className="mt-1 text-2xl font-semibold tracking-tight">{formatUnit(card.unit, card.value, currency)}</p>
      {card.previous !== undefined ? (
        <p className="mt-1 text-sm text-neutral-600">{`${move ?? "compared with"}${move ? " from" : ""} ${formatUnit(card.unit, card.previous, currency)}`}</p>
      ) : null}
      {plan ? <p className={`mt-1 text-sm ${TONE[plan.tone]}`}>{plan.text}</p> : null}
    </div>
  );
}

function Line({ data, currency }: { data: Extract<ViewData, { component: "line" }>; currency: string }) {
  const { points } = data;
  const W = 600;
  const H = 200;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const ys = points.map((p) => p.y);
  const lo = Math.min(0, ...ys);
  const hi = Math.max(...ys, lo + 1);
  const x = (i: number) => (points.length === 1 ? W / 2 : pad.l + (i / (points.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const fmt = (v: number) => formatUnit(data.unit, v, currency);
  const label = `${data.label} by ${data.dimension}, ${points.length} points from ${points[0]?.x} to ${points.at(-1)?.x}, from ${fmt(Math.min(...ys))} to ${fmt(Math.max(...ys))}`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#e5e5e5" />
        <polyline fill="none" stroke="#262626" strokeWidth="2" points={points.map((p, i) => `${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ")} />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.y)} r={points.length > 40 ? 0 : 2.5} fill="#262626" />
        ))}
        <text x={pad.l} y={H - 6} fontSize="11" fill="#737373">{points[0]?.x}</text>
        <text x={W - pad.r} y={H - 6} fontSize="11" fill="#737373" textAnchor="end">{points.at(-1)?.x}</text>
        <text x={pad.l} y={11} fontSize="11" fill="#737373">{fmt(Math.max(...ys))}</text>
      </svg>
      <Numbers head={[data.dimension, data.label]} rows={points.map((p) => [p.x, fmt(p.y)])} />
    </>
  );
}

function Bars({ data, currency }: { data: Extract<ViewData, { component: "bar" }>; currency: string }) {
  const max = Math.max(...data.bars.map((b) => b.value), 0);
  return (
    <>
      <ul className="space-y-2">
        {data.bars.map((b, i) => (
          <li key={i} className="text-sm">
            <div className="flex justify-between gap-3">
              <span className="min-w-0 truncate">{b.label}</span>
              <span className="shrink-0 text-neutral-700">{`${formatUnit(data.unit, b.value, currency)}${b.share !== undefined ? ` · ${(b.share * 100).toFixed(1)}%` : ""}`}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-neutral-100">
              <div className="h-2 rounded-full bg-neutral-800" style={{ width: `${max > 0 ? Math.round((b.value / max) * 1000) / 10 : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {data.truncated ? <p className="mt-2 text-xs text-neutral-500">{`Showing ${data.truncated.shown} of ${data.truncated.total}.`}</p> : null}
    </>
  );
}

function Table({ data, currency }: { data: Extract<ViewData, { component: "table" }>; currency: string }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              {data.columns.map((c) => (
                <th key={c.key} className="py-1 pr-3 font-normal">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="border-t border-neutral-100">
                {data.columns.map((c) => {
                  const v = r[c.key];
                  return (
                    <td key={c.key} className="py-1.5 pr-3">
                      {v === null || v === undefined ? "—" : typeof v === "number" && c.unit ? formatUnit(c.unit, v, currency) : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.rows.length === 0 ? <p className="mt-2 text-sm text-neutral-600">No rows for this period.</p> : null}
      {data.truncated ? <p className="mt-2 text-xs text-neutral-500">{`Showing ${data.truncated.shown} of ${data.truncated.total}.`}</p> : null}
    </>
  );
}

function Gauge({ g, currency }: { g: GaugeItem; currency: string }) {
  const R = 80;
  const C = 100;
  const frac = (v: number) => (g.target > 0 ? Math.min(1, Math.max(0, v / g.target)) : 0);
  const point = (f: number, r: number) => {
    const a = Math.PI * (1 - f);
    return [C + r * Math.cos(a), C - r * Math.sin(a)] as const;
  };
  const [ex, ey] = point(frac(g.actual), R);
  const [t1x, t1y] = point(frac(g.planned), R - 12);
  const [t2x, t2y] = point(frac(g.planned), R + 8);
  const money = (v: number) => formatUnit(g.unit, v, currency);
  const label = `${g.label}: ${money(g.actual)} of a ${money(g.target)} target, ${money(g.planned)} planned so far`;
  const gap = formatGap(g.metric, g.actual - g.planned, currency);
  return (
    <div className="rounded-md border border-neutral-100 p-3 text-center">
      <svg viewBox="0 0 200 118" role="img" aria-label={label} className="mx-auto h-auto w-full max-w-[220px]">
        <path d={`M ${C - R} ${C} A ${R} ${R} 0 0 1 ${C + R} ${C}`} fill="none" stroke="#e5e5e5" strokeWidth="14" />
        {frac(g.actual) > 0 ? <path d={`M ${C - R} ${C} A ${R} ${R} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}`} fill="none" stroke="#262626" strokeWidth="14" /> : null}
        <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} stroke="#0284c7" strokeWidth="3" />
        <text x={C} y={C - 8} textAnchor="middle" fontSize="18" fontWeight="600" fill="#171717">{money(g.actual)}</text>
      </svg>
      <p className="text-sm text-neutral-600">{g.label}</p>
      <p className={`text-sm ${TONE[gap.tone]}`}>{gap.text}</p>
      <dl className="mt-2 space-y-0.5 text-xs text-neutral-600">
        <div className="flex justify-between"><dt>Plan so far</dt><dd>{money(g.planned)}</dd></div>
        <div className="flex justify-between"><dt>Target for the month</dt><dd>{money(g.target)}</dd></div>
        {g.projected !== undefined ? (
          <div className="flex justify-between"><dt>Lands at about (estimate)</dt><dd>{money(g.projected)}</dd></div>
        ) : null}
      </dl>
    </div>
  );
}

function Waterfall({ data, currency }: { data: Extract<ViewData, { component: "waterfall" }>; currency: string }) {
  const W = 600;
  const H = 220;
  const pad = { t: 22, b: 40, l: 6, r: 6 };
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
  const color = (b: (typeof bars)[number]) => (b.kind !== "delta" ? "#525252" : b.value >= 0 ? "#047857" : "#be123c");
  const words = (b: (typeof bars)[number]) => (b.kind !== "delta" ? money(b.value) : b.value === 0 ? "no change" : `${b.value > 0 ? "up" : "down"} ${money(Math.abs(b.value))}`);
  const first = data.steps[0]!;
  const last = data.steps.at(-1)!;
  const label = `${data.label} by ${data.dimension}: from ${money(first.value)} to ${money(last.value)} through ${bars.filter((b) => b.kind === "delta").length} changes`;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="h-auto w-full">
        {bars.map((b, i) => {
          const top = y(Math.max(b.from, b.to));
          const height = Math.max(1, Math.abs(y(b.from) - y(b.to)));
          const x = pad.l + i * slot + slot * 0.2;
          return (
            <g key={i}>
              <rect x={x} y={top} width={slot * 0.6} height={height} fill={color(b)} />
              <text x={x + slot * 0.3} y={top - 5} textAnchor="middle" fontSize="11" fill="#404040" aria-hidden="true">
                {b.kind === "delta" ? `${b.value >= 0 ? "▲" : "▼"} ${money(Math.abs(b.value))}` : money(b.value)}
              </text>
              <text x={x + slot * 0.3} y={H - 22} textAnchor="middle" fontSize="11" fill="#737373">{b.label.length > 16 ? `${b.label.slice(0, 15)}…` : b.label}</text>
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
          <div className="grid gap-3 sm:grid-cols-3">
            {data.gauges.map((g) => (
              <Gauge key={g.metric} g={g} currency={currency} />
            ))}
          </div>
          <p className="mt-2 text-xs text-neutral-500">{`Complete days through ${formatRange(data.gauges[0]!.throughDate, data.gauges[0]!.throughDate)}. The blue mark is the plan so far; the month-end figure is an estimate.`}</p>
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
  }
}

