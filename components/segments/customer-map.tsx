"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import type { SegmentId, SegmentOrActive } from "@/lib/segments/definitions";
import {
  daysTicks,
  edgeMark,
  labelAnchors,
  listedIds,
  ltvTicks,
  MAP_SEGMENT_IDS,
  makeFrame,
  makeScales,
  MARK_RADIUS,
  markPath,
  nearestMark,
  nextInDirection,
  placeMarks,
  ruleGuides,
  segmentTitle,
  SEGMENT_SHAPE,
  type Direction,
  type MapPoint,
  type Placed,
} from "@/lib/segments/map";
import { rowDomId, useCustomerSelection } from "./customer-selection";
import { count, days, money, moneyWhole, TOP_N, wholePct } from "./format";
import { chipClick, initialMapState, mapReducer } from "./map-state";
import { Dots, Glyph, GLYPH_CLASS, strokeWidthOf } from "./map-marks";

// Every customer as one dot: how long ago they last ordered (across, most recent on the left) against what they have spent (up). It shows
// where customers sit today; it predicts nothing. Plain SVG, drawn at the width it is given so the type stays readable on a phone.
// One tab stop for the whole chart: the arrow keys move a ring between the nearest dots, Enter selects, Escape lets go. The table of top
// customers below is the full alternative for anyone who cannot use the chart, and the dots themselves are hidden from assistive technology.

const HIT_RADIUS = 16; // how close the pointer has to be to a dot, in pixels
const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const describe = (p: MapPoint, currency: string) =>
  `${p.id}, ${segmentTitle(p.segment)}, ${count(p.orders)} ${p.orders === 1 ? "order" : "orders"}, lifetime value ${money(p.ltvCents, currency)}, ${days(p.daysSinceLast)} since the last order, churn risk ${wholePct(p.churnRisk)}`;

export function CustomerMap({ points, currency, listed, initialSolo = null }: { points: MapPoint[]; currency: string; listed: SegmentId; initialSolo?: SegmentOrActive | null }) {
  const router = useRouter();
  const { selectedId, select } = useCustomerSelection();
  const ids = useId();
  const descId = `${ids}-desc`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(720);
  const [state, dispatch] = useReducer(mapReducer, initialSolo, initialMapState);
  const [announcement, setAnnouncement] = useState("");

  // Draw at the width the card gives it.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.max(280, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = width < 480;
  const stacked = width < 340; // too narrow for the three axis words side by side
  const height = (narrow ? 320 : 400) + (stacked ? 16 : 0);
  const fs = narrow ? 11 : 12;
  const scales = useMemo(() => makeScales(points), [points]);
  const guides = useMemo(() => ruleGuides(), []);
  const geo = useMemo(() => {
    const top = 26;
    const bottom = stacked ? 66 : 50;
    const probe = ltvTicks(scales.ltv, height - top - bottom);
    const longest = Math.max(...probe.map((c) => moneyWhole(c, currency).length));
    const frame = makeFrame(scales, { width, height }, { left: Math.round(longest * fs * 0.62 + 14), top, right: 14, bottom });
    const plotH = frame.bottom - frame.top;
    return {
      frame,
      yTicks: ltvTicks(scales.ltv, plotH).map((c) => ({ cents: c, y: frame.y(c), label: moneyWhole(c, currency) })),
      xTicks: (() => {
        const ticks = daysTicks(scales.days, guides.map((g) => g.days), frame.right - frame.left).map((d) => ({ d, x: frame.x(d), rule: guides.some((g) => g.days === d) }));
        const anchors = labelAnchors(ticks.map((t) => t.x), 22);
        return ticks.map((t, i) => ({ ...t, anchor: anchors[i]! }));
      })(),
      guideLines: guides.filter((g) => g.days <= scales.days.top).map((g) => ({ ...g, x: frame.x(g.days) })),
      placed: placeMarks(points, frame),
    };
  }, [scales, guides, points, width, height, fs, currency, stacked]);
  const { frame } = geo;

  const visible = useMemo(() => (state.solo ? geo.placed.filter((m) => m.segment === state.solo) : geo.placed), [geo.placed, state.solo]);
  const byId = useMemo(() => new Map(visible.map((m) => [m.id, m])), [visible]);
  const pointById = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const counts = useMemo(() => {
    const c = new Map<SegmentOrActive, number>();
    for (const p of points) c.set(p.segment, (c.get(p.segment) ?? 0) + 1);
    return c;
  }, [points]);
  const inTable = useMemo(() => listedIds(points, listed, TOP_N), [points, listed]);

  const hoverMark = state.hoverId ? byId.get(state.hoverId) : undefined;
  const focusMark = state.focusId ? byId.get(state.focusId) : undefined;
  const selectedMark = selectedId ? byId.get(selectedId) : undefined;
  const selectedPoint = selectedId ? pointById.get(selectedId) : undefined;
  const cardMark = hoverMark ?? (state.focused ? focusMark : undefined);
  const cardPoint = cardMark ? pointById.get(cardMark.id) : undefined;

  const total = points.length;
  const shown = visible.length;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || r.height <= 0) return null;
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height };
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return;
    const at = local(e);
    dispatch({ type: "hover", id: at ? (nearestMark(visible, at.x, at.y, HIT_RADIUS)?.id ?? null) : null });
  };

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    const at = local(e);
    const hit = at ? nearestMark(visible, at.x, at.y, HIT_RADIUS) : null;
    if (hit) {
      select(hit.id);
      dispatch({ type: "focus", id: hit.id });
      const p = pointById.get(hit.id);
      if (p) setAnnouncement(`Selected ${describe(p, currency)}`);
    } else if (selectedId) {
      select(null);
      setAnnouncement("Selection cleared");
    }
  };

  const moveFocusTo = (m: Placed | null) => {
    if (!m) return;
    dispatch({ type: "focus", id: m.id });
    const p = pointById.get(m.id);
    if (p) setAnnouncement(describe(p, currency));
  };

  const startMark = () => selectedMark ?? nearestMark(visible, (frame.left + frame.right) / 2, (frame.top + frame.bottom) / 2);

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const dir = ARROWS[e.key];
    if (dir) {
      e.preventDefault();
      dispatch({ type: "focused", on: true });
      moveFocusTo(focusMark ? nextInDirection(visible, focusMark.id, dir) : startMark());
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      moveFocusTo(edgeMark(visible, e.key === "Home" ? "left" : "right"));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!focusMark) return moveFocusTo(startMark());
      select(focusMark.id);
      const p = pointById.get(focusMark.id);
      if (p) setAnnouncement(`Selected ${describe(p, currency)}`);
    } else if (e.key === "Escape") {
      if (selectedId) {
        select(null);
        setAnnouncement("Selection cleared");
      } else if (state.focusId) {
        dispatch({ type: "focus", id: null });
      }
    }
  };

  const onChip = (segment: SegmentOrActive) => {
    const next = chipClick(state.solo, segment, listed);
    dispatch({ type: "solo", segment: next.solo });
    if (selectedPoint && next.solo && selectedPoint.segment !== next.solo) select(null);
    setAnnouncement(next.solo ? `Showing only ${segmentTitle(next.solo)}` : "Showing every segment");
    if (next.href) router.push(next.href, { scroll: false });
  };

  const goToRow = (id: string) => {
    const el = document.getElementById(rowDomId(id));
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: calm ? "auto" : "smooth" });
  };

  if (total === 0) {
    return <p className="muted rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm">No customers to plot yet.</p>;
  }

  const ariaLabel = `Customer map: ${count(total)} ${total === 1 ? "customer" : "customers"} by days since the last order and lifetime value. ${MAP_SEGMENT_IDS.map((s) => `${segmentTitle(s)} ${count(counts.get(s) ?? 0)}`).join(", ")}.`;
  const tipBelow = cardMark ? cardMark.y < 150 : false;

  return (
    <div>
      <ul className="flex flex-wrap gap-2">
        {MAP_SEGMENT_IDS.map((s) => {
          const n = counts.get(s) ?? 0;
          const on = state.solo === s;
          return (
            <li key={s}>
              <button
                type="button"
                aria-pressed={on}
                disabled={n === 0 && !on}
                onClick={() => onChip(s)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.8125rem] font-medium sm:gap-2 sm:px-3 sm:py-1.5 sm:text-sm disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-transparent bg-brand-tint text-brand-strong" : "border-line-strong bg-surface text-ink-2 hover:bg-paper-2"}`}
              >
                <Glyph segment={s} />
                {segmentTitle(s)}
                <span className="num text-xs font-normal opacity-80">{count(n)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" className="faint mt-2 flex flex-wrap items-center gap-x-3 text-xs">
        <span>
          {state.solo ? `Showing ${count(shown)} of ${count(total)} customers, only ${segmentTitle(state.solo)}.` : `Showing all ${count(total)} ${total === 1 ? "customer" : "customers"}.`}
        </span>
        {state.solo ? (
          <button type="button" onClick={() => onChip(state.solo!)} className="cursor-pointer rounded-md font-medium text-brand-strong underline underline-offset-2">
            Show every segment
          </button>
        ) : null}
        {state.solo && state.solo !== "active" && state.solo === listed ? (
          <a href="#top-customers" className="rounded-md font-medium text-brand-strong underline underline-offset-2">
            See the top customers of {segmentTitle(state.solo)} in the table
          </a>
        ) : null}
        {!state.solo ? <span>Pick a segment to show only its dots and list its top customers below.</span> : null}
      </p>

      <p id={descId} className="sr-only">
        Use the arrow keys to move between customers, Home and End to jump to the most recent or the longest ago, Enter to select one and Escape to let go. The Top customers table below
        lists the highest value customers of each segment as text, and the segment cards above give the counts, so nothing is only on this chart.
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <div ref={wrapRef} className="relative mt-3 w-full min-w-0 overflow-x-clip">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={ariaLabel}
          aria-describedby={descId}
          tabIndex={0}
          className={`block h-auto w-full rounded-md focus-visible:outline-offset-[-2px] ${hoverMark ? "cursor-pointer" : ""}`}
          style={{ touchAction: "pan-y" }}
          onPointerMove={onMove}
          onPointerLeave={() => dispatch({ type: "hover", id: null })}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onFocus={(e) => {
            if (!e.currentTarget.matches(":focus-visible")) return;
            dispatch({ type: "focused", on: true });
            if (!focusMark) moveFocusTo(startMark());
          }}
          onBlur={() => dispatch({ type: "focused", on: false })}
        >
          <text x={4} y={12} fontSize={fs} className="fill-ink-3">
            {"↑"} Lifetime value
          </text>
          {geo.yTicks.map((t) => (
            <g key={t.cents}>
              <line x1={frame.left} x2={frame.right} y1={t.y} y2={t.y} className="stroke-line" />
              <text x={frame.left - 8} y={t.y + 4} textAnchor="end" fontSize={fs} className="fill-ink-3">
                {t.label}
              </text>
            </g>
          ))}
          {geo.guideLines.map((g) => (
            <line key={g.days} x1={g.x} x2={g.x} y1={frame.top} y2={frame.bottom} className="stroke-line-strong" />
          ))}
          {geo.xTicks.map((t) => (
            <text key={t.d} x={t.x} y={frame.bottom + 16} textAnchor={t.anchor} fontSize={fs} fontWeight={t.rule ? 600 : 400} className={t.rule ? "fill-ink-2" : "fill-ink-3"}>
              {count(t.d)}
            </text>
          ))}
          <text x={frame.left} y={frame.bottom + (stacked ? 54 : 38)} fontSize={fs} className="fill-ink-3">
            {"←"} {narrow ? "Recent" : "Ordered more recently"}
          </text>
          <text x={(frame.left + frame.right) / 2} y={frame.bottom + 38} textAnchor="middle" fontSize={fs} fontWeight={600} className="fill-ink-2">
            Days since last order
          </text>
          <text x={frame.right} y={frame.bottom + (stacked ? 54 : 38)} textAnchor="end" fontSize={fs} className="fill-ink-3">
            {narrow ? "Longer ago" : "Ordered longer ago"} {"→"}
          </text>

          <Dots marks={visible} />

          <g aria-hidden pointerEvents="none">
            {selectedMark && selectedPoint ? (
              <>
                <circle cx={selectedMark.x} cy={selectedMark.y} r={MARK_RADIUS + 6.5} fill="none" strokeWidth={2.5} className="stroke-surface" />
                <circle cx={selectedMark.x} cy={selectedMark.y} r={MARK_RADIUS + 5} fill="none" strokeWidth={2} className="stroke-ink" />
                <path d={markPath(SEGMENT_SHAPE[selectedMark.segment], selectedMark.x, selectedMark.y, MARK_RADIUS + 0.5)} className={GLYPH_CLASS[selectedMark.segment]} strokeWidth={strokeWidthOf(selectedMark.segment) + 0.4} />
              </>
            ) : null}
            {hoverMark && hoverMark.id !== selectedId ? <circle cx={hoverMark.x} cy={hoverMark.y} r={MARK_RADIUS + 4} fill="none" strokeWidth={1.5} className="stroke-ink" /> : null}
            {state.focused && focusMark ? <circle cx={focusMark.x} cy={focusMark.y} r={MARK_RADIUS + 7.5} fill="none" strokeWidth={2} className="stroke-brand" /> : null}
          </g>
        </svg>

        {cardMark && cardPoint ? (
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 rounded-[10px] bg-inverse px-3 py-2 text-[12.5px] leading-[1.45] whitespace-nowrap text-on-inverse shadow-pop"
            style={{ left: clamp(cardMark.x, 92, Math.max(92, width - 92)), top: cardMark.y, transform: tipBelow ? "translate(-50%, 14px)" : "translate(-50%, calc(-100% - 14px))" }}
          >
            <div className="font-mono text-[12px]">{cardPoint.id}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <Glyph segment={cardPoint.segment} size={12} className="fill-on-inverse stroke-on-inverse" />
              {segmentTitle(cardPoint.segment)}
            </div>
            <div className="mt-1">
              Lifetime value <b className="num font-semibold">{money(cardPoint.ltvCents, currency)}</b>
            </div>
            <div>
              Orders <b className="num font-semibold">{count(cardPoint.orders)}</b>
            </div>
            <div>
              Since last order <b className="num font-semibold">{days(cardPoint.daysSinceLast)}</b>
            </div>
            <div>
              Churn risk <b className="num font-semibold">{wholePct(cardPoint.churnRisk)}</b>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 flex min-h-[3.25rem] flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm">
        {selectedPoint ? (
          <>
            <span className="inline-flex items-center gap-2">
              <Glyph segment={selectedPoint.segment} />
              <span className="font-mono text-[0.8125rem]">{selectedPoint.id}</span>
              <span className="faint">{segmentTitle(selectedPoint.segment)}</span>
            </span>
            <dl className="flex flex-wrap gap-x-5 gap-y-1">
              <div>
                <dt className="faint text-xs">Orders</dt>
                <dd className="num font-medium">{count(selectedPoint.orders)}</dd>
              </div>
              <div>
                <dt className="faint text-xs">Lifetime value</dt>
                <dd className="num font-medium">{money(selectedPoint.ltvCents, currency)}</dd>
              </div>
              <div>
                <dt className="faint text-xs">Since last order</dt>
                <dd className="num font-medium">{days(selectedPoint.daysSinceLast)}</dd>
              </div>
              <div>
                <dt className="faint text-xs">Churn risk</dt>
                <dd className="num font-medium">{wholePct(selectedPoint.churnRisk)}</dd>
              </div>
            </dl>
            <span className="ml-auto flex items-center gap-1">
              {inTable.has(selectedPoint.id) ? (
                <button type="button" onClick={() => goToRow(selectedPoint.id)} className="btn btn-ghost btn-sm">
                  Show in table below
                </button>
              ) : null}
              <button type="button" onClick={() => select(null)} className="btn btn-ghost btn-sm">
                Clear
              </button>
            </span>
          </>
        ) : (
          <span className="muted">Hover a dot, or tab to the chart and use the arrow keys. Click or press Enter to select a customer.</span>
        )}
      </div>

      <p className="faint mt-3 max-w-[78ch] text-xs">
        Each dot is one customer, the shapes and colours are their segment. The days axis is stretched near zero and the value axis is compressed toward the top, so a few very large
        customers do not flatten everyone else. Faint lines mark the day counts the segment rules use: {geo.guideLines.map((g) => g.note).join(", ")}. Due to reorder has no line because it
        compares each customer with their own usual gap.
      </p>
    </div>
  );
}
