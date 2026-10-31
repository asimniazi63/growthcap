"use client";

import { Check, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ProvenanceEntry } from "@/lib/agent/run";
import { toolLabel } from "./tool-labels";

// The proof drawer: click a checked figure in an answer and this panel shows where it came from. It shows only what the
// provenance entry holds (the tool, the query id, the dates, when the data was read, the arguments, the metric
// definitions); nothing here is worked out again.

export const DRAWER_ID = "proof-drawer";

export interface ProofTarget {
  claim: string; // the figure as written in the answer, for example "$6,294.48"
  entry: ProvenanceEntry;
  key?: string; // identifies the clicked figure, so it can show aria-expanded
  trigger?: HTMLElement | null; // where focus goes back to when the drawer closes
}

export interface ProofDrawerApi {
  current: ProofTarget | null;
  open: (target: ProofTarget) => void;
  close: () => void;
}

export const ProofDrawerContext = createContext<ProofDrawerApi | null>(null);

// The drawer's state. The chat screen calls this once, provides the result through ProofDrawerContext, and renders
// <ProofDrawerPanel />. Esc closes it, and focus goes back to the figure that opened it.
export function useProofDrawerState(): ProofDrawerApi {
  const [current, setCurrent] = useState<ProofTarget | null>(null);

  const open = useCallback((target: ProofTarget) => setCurrent(target), []);
  const close = useCallback(() => {
    setCurrent(null);
    const back = current?.trigger;
    if (back?.isConnected) back.focus();
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current, close]);

  return useMemo(() => ({ current, open, close }), [current, open, close]);
}

// ---- Plain-words formatting (pure, so it can be checked on its own) ----

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseDay(text: string): { y: number; m: number; d: number } | null {
  const hit = DAY.exec(text);
  if (!hit) return null;
  const [y, m, d] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null;
}

// "2026-09-01" to "2026-09-30" reads "September 1 to 30, 2026".
export function formatPeriod(range: { from: string; to: string }): string {
  const a = parseDay(range.from);
  const b = parseDay(range.to);
  if (!a || !b) return range.from === range.to ? range.from : `${range.from} to ${range.to}`;
  const first = `${MONTHS[a.m - 1]} ${a.d}`;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${first}, ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${first} to ${b.d}, ${a.y}`;
  if (a.y === b.y) return `${first} to ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`;
  return `${first}, ${a.y} to ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
}

// "2026-10-31T10:34:00.000Z" reads "October 31, 10:34 UTC" (with the year when it is not this year).
export function formatAsOf(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = at.getUTCFullYear() === now.getUTCFullYear() ? "" : `, ${at.getUTCFullYear()}`;
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}${year}, ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
}

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

export function ProofDrawerPanel() {
  const drawer = useContext(ProofDrawerContext);
  const closeRef = useRef<HTMLButtonElement>(null);
  const current = drawer?.current ?? null;

  // Move focus into the panel when it opens or switches to another figure.
  useEffect(() => {
    if (current) closeRef.current?.focus();
  }, [current]);

  if (!drawer || !current) return null;
  const { claim, entry } = current;
  const asked = isObject(entry.input) && typeof entry.input.period === "string" ? scalarText(entry.input.period) : null;
  const rows = filterRows(entry.input);
  const definitions = Object.entries(entry.definitions);

  return (
    <aside
      id={DRAWER_ID}
      aria-label="Where this number came from"
      className="relative mt-3 rounded-2xl border border-line bg-surface p-5 shadow-card lg:absolute lg:inset-y-0 lg:right-0 lg:z-20 lg:mt-0 lg:w-[360px] lg:overflow-y-auto lg:rounded-none lg:border-y-0 lg:border-r-0 lg:p-6 lg:shadow-pop"
    >
      <button ref={closeRef} type="button" onClick={drawer.close} aria-label="Close" className="btn btn-ghost absolute right-3 top-3 p-1.5">
        <X className="size-4" aria-hidden />
      </button>

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
        <div className="inset mt-5 space-y-2 p-3.5 text-[0.8125rem] leading-5 text-ink-2">
          {definitions.map(([metric, definition]) => (
            <p key={metric}>
              <b className="font-semibold text-ink">{humanize(metric)}.</b> {definition}
            </p>
          ))}
        </div>
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
