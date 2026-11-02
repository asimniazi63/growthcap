"use client";

import { Check, ChevronLeft, ChevronRight, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { TracedFigure } from "@/lib/agent/traced";
import type { ProvenanceEntry } from "@/lib/agent/run";
import { badgeText, figureSource } from "./traced-format";
import { toolLabel } from "./tool-labels";
import { formatAsOf, formatPeriod } from "./when";

export { formatAsOf, formatPeriod };

// The proof drawer: click a checked figure in an answer and this panel shows where it came from. It shows only what the
// provenance entry holds (the tool, the query id, the dates, when the data was read, the arguments, the metric
// definitions); nothing here is worked out again. Opened from an answer's badge instead, it lists every traced figure with its
// source, and a figure in the list opens its query, with a way back to the list.

export const DRAWER_ID = "proof-drawer";

export interface ProofTarget {
  claim: string; // the figure as written in the answer, for example "$6,294.48"
  entry: ProvenanceEntry;
  key?: string; // identifies the clicked figure, so it can show aria-expanded
  trigger?: HTMLElement | null; // where focus goes back to when the drawer closes
}

export interface FigureListTarget {
  figures: TracedFigure[];
  provenance: Record<string, ProvenanceEntry>;
  traced: number; // every figure the checker traced, including any the server left out of `figures`
  total: number; // traced plus not found
  unmatched: string[];
  trigger?: HTMLElement | null;
}

export interface ProofDrawerApi {
  current: ProofTarget | null;
  list: FigureListTarget | null;
  open: (target: ProofTarget, options?: { fromList?: boolean }) => void;
  openList: (target: FigureListTarget) => void;
  back: () => void; // from one query to the list it was opened from
  close: () => void;
}

export const ProofDrawerContext = createContext<ProofDrawerApi | null>(null);

export interface DrawerView {
  current: ProofTarget | null;
  list: FigureListTarget | null;
}
const CLOSED: DrawerView = { current: null, list: null };

type DrawerAction = { type: "open"; target: ProofTarget; fromList?: boolean } | { type: "openList"; target: FigureListTarget } | { type: "back" } | { type: "close" };

// A figure clicked in the text shows its query alone; one picked from the list keeps the list to go back to.
export function drawerReducer(view: DrawerView, action: DrawerAction): DrawerView {
  switch (action.type) {
    case "open":
      return { current: action.target, list: action.fromList ? view.list : null };
    case "openList":
      return { current: null, list: action.target };
    case "back":
      return { ...view, current: null };
    case "close":
      return CLOSED;
  }
}

// Where focus goes when the drawer closes: the badge when the list was open (the list's own buttons are gone by then), else the figure.
export function returnTarget(view: DrawerView): HTMLElement | null | undefined {
  return view.list?.trigger ?? view.current?.trigger;
}

// The drawer's state. The chat screen calls this once, provides the result through ProofDrawerContext, and renders
// <ProofDrawerPanel />. Esc closes it, and focus goes back to the figure (or the badge) that opened it.
export function useProofDrawerState(): ProofDrawerApi {
  const [view, dispatch] = useReducer(drawerReducer, CLOSED);
  const { current, list } = view;

  const open = useCallback((target: ProofTarget, options?: { fromList?: boolean }) => dispatch({ type: "open", target, fromList: options?.fromList }), []);
  const openList = useCallback((target: FigureListTarget) => dispatch({ type: "openList", target }), []);
  const back = useCallback(() => dispatch({ type: "back" }), []);
  const close = useCallback(() => {
    dispatch({ type: "close" });
    const returnTo = returnTarget({ current, list });
    if (returnTo?.isConnected) returnTo.focus();
  }, [current, list]);

  const showing = current !== null || list !== null;
  useEffect(() => {
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showing, close]);

  return useMemo(() => ({ current, list, open, openList, back, close }), [current, list, open, openList, back, close]);
}

// ---- Plain-words formatting (pure, so it can be checked on its own) ----

function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const MAX_ROWS = 12;
const MAX_TEXT = 140;
// The resolved dates are shown as the period, so the arguments that asked for them are not repeated as filters.
const PERIOD_KEYS = new Set(["from", "to", "period"]);

const clip = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function scalarText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    return clip(/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(s) ? s.replace(/_/g, " ") : s); // an option name like last_30_days reads as words
  }
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return null;
}

export interface FilterRow {
  label: string;
  value: string;
}

// The arguments of the query as label/value rows. Empty values are skipped; the text is the model's, so it is only ever drawn as text.
export function filterRows(input: unknown): FilterRow[] {
  const rows: FilterRow[] = [];
  const labelFor = (path: string[]) => {
    const leaf = humanize(path.at(-1) ?? "");
    const parent = path.at(-2);
    return parent && parent !== "filters" ? `${humanize(parent)} ${leaf.toLowerCase()}` : leaf;
  };
  const walk = (value: unknown, path: string[]) => {
    if (rows.length >= MAX_ROWS) return;
    if (Array.isArray(value)) {
      if (value.length === 0) return;
      const scalars = value.map(scalarText);
      const text = scalars.every((s) => s !== null) ? scalars.join(", ") : clip(JSON.stringify(value));
      rows.push({ label: labelFor(path), value: clip(text) });
      return;
    }
    if (isObject(value)) {
      if (path.length >= 3) {
        const text = JSON.stringify(value);
        if (text !== "{}") rows.push({ label: labelFor(path), value: clip(text) });
        return;
      }
      for (const [k, v] of Object.entries(value)) {
        if (path.length === 0 && PERIOD_KEYS.has(k)) continue;
        walk(v, [...path, k]);
      }
      return;
    }
    const text = scalarText(value);
    if (text) rows.push({ label: labelFor(path), value: text });
  };
  walk(input, []);
  return rows;
}

// ---- The panel ----

const PANEL_CLASS = "relative mt-3 rounded-2xl border border-line bg-surface p-5 shadow-card lg:absolute lg:inset-y-0 lg:right-0 lg:z-20 lg:mt-0 lg:w-[360px] lg:overflow-y-auto lg:rounded-none lg:border-y-0 lg:border-r-0 lg:p-6 lg:shadow-pop";

// Every traced figure of one answer, each with where it came from. Opening one shows its query; this is also how a keyboard or
// screen reader user reaches what a mouse user gets from hovering a figure.
function FigureList({ target, drawer }: { target: FigureListTarget; drawer: ProofDrawerApi }) {
  const { figures, provenance, traced, total, unmatched } = target;
  const listed = figures.reduce((n, f) => n + f.count, 0);
  const left = Math.max(0, traced - listed);
  return (
    <>
      <span className={`badge ${total > traced ? "badge-warn" : "badge-brand"}`}>
        {total > traced ? <TriangleAlert className="size-3.5" aria-hidden /> : <Check className="size-3.5" strokeWidth={3} aria-hidden />}
        {badgeText(traced, total)}
      </span>
      <h3 className="mt-3 font-display text-lg font-semibold leading-snug">Figures in this answer</h3>
      <p className="faint mt-1 text-[0.8125rem] leading-5">Each one equals a value the assistant read from the store. Pick one to see the query behind it.</p>

      <ul aria-label="Traced figures" className="mt-4 divide-y divide-line border-y border-line">
        {figures.map((f, i) => {
          const entry = provenance[f.queryId];
          const { source, period, synced } = figureSource(f);
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="num block break-words text-[0.9375rem] font-semibold">
                  {f.text}
                  {f.count > 1 ? <span className="faint font-normal"> ({f.count} times)</span> : null}
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-ink-2">
                  {source}
                  {period ? `, ${period}` : ""}
                </span>
                {synced ? <span className="block text-xs leading-5 text-ink-3">Synced {synced}</span> : null}
              </span>
              {entry ? (
                <span className="flex shrink-0 items-center text-brand-strong">
                  <span className="sr-only">See the query</span>
                  <ChevronRight className="size-4" aria-hidden />
                </span>
              ) : null}
            </>
          );
          return (
            <li key={`${f.text}-${f.queryId}-${i}`}>
              {entry ? (
                <button
                  type="button"
                  onClick={(e) => drawer.open({ claim: f.text, entry, key: `list-${i}`, trigger: e.currentTarget }, { fromList: true })}
                  className="flex w-full cursor-pointer items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-paper"
                >
                  {body}
                </button>
              ) : (
                <div className="flex w-full items-center gap-3 px-1 py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {left > 0 ? <p className="faint mt-2 text-xs">And {left} more traced {left === 1 ? "figure" : "figures"}, not listed here.</p> : null}

      {unmatched.length > 0 ? (
        <section aria-label="Figures not found" className="mt-5 rounded-xl border border-warn/30 bg-warn-tint px-3.5 py-3 text-[0.8125rem] leading-5 text-ink">
          <h4 className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-3.5 shrink-0 text-warn" aria-hidden />
            Not found in the store data
          </h4>
          <p className="num mt-1 break-words">{unmatched.join(", ")}</p>
          <p className="mt-1 text-ink-2">Treat {unmatched.length === 1 ? "this number" : "these numbers"} with care.</p>
        </section>
      ) : null}
    </>
  );
}

export function ProofDrawerPanel() {
  const drawer = useContext(ProofDrawerContext);
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = drawer?.current ?? null;
  const list = drawer?.list ?? null;

  // Move focus into the panel when it opens or switches to another figure or back to the list.
  useEffect(() => {
    if (current || list) closeRef.current?.focus();
  }, [current, list]);

  if (!drawer || (!current && !list)) return null;

  const closeButton = (
    <button ref={closeRef} type="button" onClick={drawer.close} aria-label="Close" className="btn btn-ghost absolute right-3 top-3 p-1.5">
      <X className="size-4" aria-hidden />
    </button>
  );

  if (!current && list) {
    return (
      <aside id={DRAWER_ID} aria-label="Figures traced in this answer" className={PANEL_CLASS}>
        {closeButton}
        <FigureList target={list} drawer={drawer} />
      </aside>
    );
  }

  const { claim, entry } = current!;
  const asked = isObject(entry.input) && typeof entry.input.period === "string" ? scalarText(entry.input.period) : null;
  const rows = filterRows(entry.input);
  const definitions = Object.entries(entry.definitions);

  return (
    <aside id={DRAWER_ID} aria-label="Where this number came from" className={PANEL_CLASS}>
      {closeButton}

      {list ? (
        <button type="button" onClick={drawer.back} className="btn btn-ghost btn-sm -ml-2 mb-2">
          <ChevronLeft className="size-4" aria-hidden />
          All figures in this answer
        </button>
      ) : null}

      <span className="badge badge-brand">
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
        Checked against the store data
      </span>
      <p className="stat mt-3 break-words text-[1.875rem]">{claim}</p>

      <dl className="mt-4 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
        <dt className="faint">Source</dt>
        <dd>{toolLabel(entry.tool)}</dd>
        <dt className="faint">Query</dt>
        <dd>
          <span className="inline-block max-w-full break-all rounded-md bg-paper-2 px-1.5 py-0.5 font-mono text-xs text-ink-2">{entry.queryId}</span>
        </dd>
        <dt className="faint">Period</dt>
        <dd className="num">
          {formatPeriod(entry.range)}
          {asked ? <span className="faint"> ({asked})</span> : null}
        </dd>
        <dt className="faint">Data as of</dt>
        <dd className="num">{formatAsOf(entry.asOf)}</dd>
      </dl>

      {rows.length > 0 ? (
        <section className="mt-5" aria-label="Filters used">
          <h3 className="text-sm font-semibold">Filters</h3>
          <dl className="mt-2 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            {rows.map((r, i) => (
              <div key={`${r.label}-${i}`} className="contents">
                <dt className="faint">{r.label}</dt>
                <dd className="break-words">{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {definitions.length > 0 ? (
        <details className="inset group mt-5 text-[0.8125rem] leading-5 text-ink-2" open={definitions.length === 1}>
          <summary className="cursor-pointer select-none px-3.5 py-2.5 font-semibold text-ink">{definitions.length === 1 ? "Definition" : `Definitions (${definitions.length})`}</summary>
          <div className="space-y-2 px-3.5 pb-3.5">
            {definitions.map(([metric, definition]) => (
              <p key={metric}>
                <b className="font-semibold text-ink">{humanize(metric)}.</b> {definition}
              </p>
            ))}
          </div>
        </details>
      ) : null}

      {entry.truncated ? (
        <p role="note" className="num mt-5 flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-tint px-3 py-2.5 text-[0.8125rem] leading-5 text-ink">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
          Showing {entry.truncated.shown} of {entry.truncated.total}. The rest was left out of this result.
        </p>
      ) : null}
    </aside>
  );
}
