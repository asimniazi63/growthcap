"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { ANNOTATION_KINDS, ANNOTATION_KIND_LABEL, ANNOTATION_LEGEND_LABEL, type AnnotationKind, type PaceAnnotation } from "@/lib/pace/annotation-types";
import { nextMarkerIndex } from "@/lib/pace/markers";

// The timeline under the Pace chart's day axis: one small marker per thing that explains the month. Each kind has its own SHAPE
// (diamond, circle, triangle, square), so colour is never the only cue. Markers are real buttons laid over the SVG so they take
// focus: one tab stop, arrow keys move along them in date order. Labels and details can be store text and are printed as text only.

const longDate = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const shortDate = (ymd: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const KIND_TEXT: Record<AnnotationKind, string> = { calendar: "text-ink-2", note: "text-ink-2", code: "text-ink-2", stockout: "text-warn" };

// A marker's shape. Filled with a surface-colour halo so it reads over the lines; hollow (an outline) when its kind is switched off.
export function Glyph({ kind, filled = true, size = 13 }: { kind: AnnotationKind; filled?: boolean; size?: number }) {
  const ink = filled ? "fill-current stroke-surface" : "fill-none stroke-current";
  const common = { className: ink, strokeWidth: filled ? 1.4 : 1.6, strokeLinejoin: "round" as const, style: { paintOrder: "stroke" } };
  return (
    <svg viewBox="0 0 14 14" width={size} height={size} aria-hidden focusable="false" className={KIND_TEXT[kind]}>
      {kind === "calendar" ? <path d="M7 1 L13 7 L7 13 L1 7 Z" {...common} /> : null}
      {kind === "note" ? <circle cx={7} cy={7} r={5.6} {...common} /> : null}
      {kind === "code" ? <path d="M7 1.4 L13.2 12.4 L0.8 12.4 Z" {...common} /> : null}
      {kind === "stockout" ? (
        <>
          <rect x={1.6} y={1.6} width={10.8} height={10.8} rx={1.8} {...common} />
          <path d="M4.7 4.7 L9.3 9.3 M9.3 4.7 L4.7 9.3" fill="none" strokeWidth={1.5} strokeLinecap="round" className={filled ? "stroke-surface" : "stroke-current"} />
        </>
      ) : null}
    </svg>
  );
}

export interface PlacedMarker {
  a: PaceAnnotation;
  x: number; // centre, in chart units (the SVG's viewBox)
  y: number;
  dim: boolean; // after the day the scrubber is on
}

export function AnnotationMarkers({ markers, width, height, onGuide }: { markers: PlacedMarker[]; width: number; height: number; onGuide: (date: string | null) => void }) {
  const cardId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [roving, setRoving] = useState(0); // the one marker in the tab order
  const [shown, setShown] = useState<number | null>(null); // the marker whose card is open
  const stop = Math.min(roving, Math.max(0, markers.length - 1));
  const open = shown !== null && shown < markers.length ? markers[shown]! : null;

  const show = (i: number) => {
    setShown(i);
    onGuide(markers[i]?.a.date ?? null);
  };
  const hide = () => {
    setShown(null);
    onGuide(null);
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "Escape") {
      hide();
      return;
    }
    const next = nextMarkerIndex(e.key, i, markers.length);
    if (next === null) return;
    e.preventDefault();
    if (next !== i) {
      setRoving(next);
      refs.current[next]?.focus();
    }
  };

  return (
    <>
      {markers.map((m, i) => {
        const label = `${longDate(m.a.date)}, ${ANNOTATION_KIND_LABEL[m.a.kind]}: ${m.a.label}${m.dim ? " (after the day shown)" : ""}`;
        return (
          <button
            key={`${m.a.date}|${m.a.kind}|${m.a.label}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            aria-label={label}
            aria-describedby={shown === i ? cardId : undefined}
            tabIndex={i === stop ? 0 : -1}
            data-kind={m.a.kind}
            data-dim={m.dim ? "true" : undefined}
            className={`absolute grid size-[22px] -translate-x-1/2 -translate-y-1/2 cursor-default place-items-center rounded-full ${m.dim ? "opacity-35" : ""}`}
            style={{ left: `${(m.x / width) * 100}%`, top: `${(m.y / height) * 100}%` }}
            onPointerEnter={() => show(i)}
            onPointerLeave={hide}
            onFocus={() => {
              setRoving(i);
              show(i);
            }}
            onBlur={hide}
            onClick={() => show(i)}
            onKeyDown={(e) => onKey(e, i)}
          >
            <Glyph kind={m.a.kind} />
          </button>
        );
      })}
      {open ? (
        <div
          id={cardId}
          role="tooltip"
          className="pointer-events-none absolute z-10 w-max max-w-[16rem] rounded-[10px] bg-inverse px-3 py-2 text-[12.5px] leading-[1.45] text-on-inverse shadow-pop"
          style={{
            left: `${(clamp(open.x, 140, Math.max(140, width - 140)) / width) * 100}%`,
            top: `${(open.y / height) * 100}%`,
            transform: "translate(-50%, calc(-100% - 16px))",
          }}
        >
          <div className="text-on-inverse/70">
            {longDate(open.a.date)} · {ANNOTATION_KIND_LABEL[open.a.kind]}
          </div>
          <div className="font-semibold break-words">{open.a.label}</div>
          {open.a.detail ? <div className="mt-0.5 text-[12px] break-words text-on-inverse/80">{open.a.detail}</div> : null}
        </div>
      ) : null}
    </>
  );
}

// The legend that is also the filter: one button per kind that has markers. On is a filled shape, off an outline with the words
// still in the same size, so the state is readable without colour.
export function AnnotationLegend({ counts, off, onToggle }: { counts: Record<AnnotationKind, number>; off: readonly AnnotationKind[]; onToggle: (kind: AnnotationKind) => void }) {
  const kinds = ANNOTATION_KINDS.filter((k) => counts[k] > 0);
  if (kinds.length === 0) return null;
  return (
    <div role="group" aria-label="Timeline markers" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
      <span className="faint mr-1">On the timeline</span>
      {kinds.map((k) => {
        const on = !off.includes(k);
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(k)}
            className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${on ? "border-line-strong bg-surface text-ink-2 hover:text-ink" : "border-dashed border-line-strong bg-transparent text-ink-3 hover:text-ink-2"}`}
          >
            <Glyph kind={k} filled={on} size={12} />
            <span>
              {ANNOTATION_LEGEND_LABEL[k]} <span className="num">{counts[k]}</span>
              <span className="sr-only">{on ? ", shown" : ", hidden"}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The same markers as plain text, for the "Show the numbers" panel: every one, whatever the filter says.
export function AnnotationList({ annotations }: { annotations: readonly PaceAnnotation[] }) {
  if (annotations.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="muted font-medium">On the timeline</p>
      <ul className="mt-1 space-y-1.5 text-[13.5px]">
        {annotations.map((a) => (
          <li key={`${a.date}|${a.kind}|${a.label}`}>
            <span className="num font-medium">{shortDate(a.date)}</span> <span className="muted">· {ANNOTATION_KIND_LABEL[a.kind]}:</span> {a.label}
            {a.detail ? <span className="muted"> — {a.detail}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
