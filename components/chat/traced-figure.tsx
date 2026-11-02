"use client";

import { Check } from "lucide-react";
import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ProvenanceEntry } from "@/lib/agent/run";
import type { TracedFigure } from "@/lib/agent/traced";
import { DRAWER_ID, ProofDrawerContext, type ProofTarget } from "./proof-drawer";
import { figureLabel, figureSource } from "./traced-format";

// A figure the number checker traced, drawn in the answer's text with a dotted underline. Hovering it (or focusing it with the
// keyboard) shows where it came from; clicking it, or pressing Enter, opens the query in the proof drawer.
//
// Keyboard: the figures are not tab stops, or a long answer would cost dozens of Tab presses. They become tabbable while focus is
// inside the answer (InspectScope), so Shift+Tab from the answer's badge walks back through them; the badge's list in the
// drawer holds the same information for everyone, in one place.

export interface TracedState {
  figures: TracedFigure[];
  provenance: Record<string, ProvenanceEntry>;
}

export const TracedContext = createContext<TracedState>({ figures: [], provenance: {} });
export const InspectContext = createContext(false);

// Tells the figures inside it whether focus is somewhere in the answer. The state lives here, not in the message, so a focus change
// re-renders only the figures and never the whole answer.
export function InspectScope({ children, className }: { children: ReactNode; className?: string }) {
  const [inside, setInside] = useState(false);
  return (
    <InspectContext.Provider value={inside}>
      <div
        className={className}
        onFocus={() => setInside(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setInside(false);
        }}
      >
        {children}
      </div>
    </InspectContext.Provider>
  );
}

// ---- Where the card goes ----

export interface CardPlace {
  left: number;
  top?: number; // below the figure
  bottom?: number; // above the figure
}

export const CARD_WIDTH = 288;
const CARD_HEIGHT = 150; // about what the card needs, to decide whether it fits below
const EDGE = 8;

// A card under the figure when it fits there, above it when it does not, and never off the side of the screen. The figure's box
// is the one the browser reports (viewport coordinates), and the card is drawn with `position: fixed` in the same terms.
export function placeCard(rect: { left: number; top: number; bottom: number }, viewport: { width: number; height: number }): CardPlace {
  const width = Math.min(CARD_WIDTH, viewport.width - 2 * EDGE);
  const left = Math.max(EDGE, Math.min(rect.left, viewport.width - width - EDGE));
  const fitsBelow = rect.bottom + CARD_HEIGHT <= viewport.height;
  const fitsAbove = rect.top - CARD_HEIGHT >= 0;
  return !fitsBelow && fitsAbove ? { left, bottom: viewport.height - rect.top } : { left, top: rect.bottom };
}

const CLOSE_DELAY_MS = 140;

// What the drawer is given when a figure is opened: the figure as written, and the query behind it.
export function queryTarget(figure: TracedFigure, entry: ProvenanceEntry, key: string, trigger: HTMLElement | null): ProofTarget {
  return { claim: figure.text, entry, key, trigger };
}

// Keys on a focused figure: Enter or Space opens the query, Escape closes the card.
export function figureKey(key: string, cardOpen: boolean): "open" | "close" | null {
  if (key === "Enter" || key === " ") return "open";
  if (key === "Escape" && cardOpen) return "close";
  return null;
}

// The card that says where a figure came from. Its outer box has padding instead of a gap, so the pointer can travel from the
// figure to the card without leaving both. "See the query" is for the mouse: a keyboard user presses Enter on the figure itself,
// so the button is not another tab stop.
export function FigureCard({ id, figure, place, viewportWidth, onOpen, onEnter, onLeave }: { id: string; figure: TracedFigure; place: CardPlace; viewportWidth: number; onOpen?: () => void; onEnter?: () => void; onLeave?: () => void }) {
  const { source, period, synced } = figureSource(figure);
  return (
    <span
      id={id}
      role="dialog"
      aria-label={`Where ${figure.text} came from`}
      style={{ position: "fixed", left: place.left, top: place.top, bottom: place.bottom, width: Math.min(CARD_WIDTH, viewportWidth - 2 * EDGE) }}
      className="z-50 block py-1.5 text-left font-sans text-[0.8125rem] font-normal leading-5 text-ink"
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="block rounded-xl border border-line bg-surface px-3.5 py-3 shadow-pop">
        <span className="flex items-center gap-1.5 font-display text-sm font-semibold">
          <Check className="size-3.5 shrink-0 text-brand-strong" strokeWidth={3} aria-hidden />
          <span className="num min-w-0 break-words">{figure.text}</span>
        </span>
        <span className="mt-1.5 block text-ink-2">
          From {source}
          {period ? `, ${period}` : ""}
        </span>
        {synced ? <span className="block text-ink-3">Synced {synced}</span> : null}
        {onOpen ? (
          <button type="button" tabIndex={-1} onClick={onOpen} className="mt-2.5 cursor-pointer text-[0.8125rem] font-semibold text-brand-strong underline underline-offset-2 hover:decoration-2">
            See the query
          </button>
        ) : null}
      </span>
    </span>
  );
}

function TracedSpan({ figure, entry, children }: { figure: TracedFigure; entry: ProvenanceEntry | undefined; children: ReactNode }) {
  const id = useId();
  const drawer = useContext(ProofDrawerContext);
  const inspect = useContext(InspectContext);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [place, setPlace] = useState<CardPlace | null>(null);
  const open = place !== null;
  const canOpen = Boolean(drawer && entry);
  const active = drawer?.current?.key === id;

  const show = () => {
    clearTimeout(timer.current);
    const box = ref.current?.getBoundingClientRect();
    if (box) setPlace(placeCard(box, { width: window.innerWidth, height: window.innerHeight }));
  };
  const hideSoon = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPlace(null), CLOSE_DELAY_MS);
  };
  const keep = () => clearTimeout(timer.current);
  const openQuery = () => {
    if (!drawer || !entry) return;
    clearTimeout(timer.current);
    setPlace(null);
    drawer.open(queryTarget(figure, entry, id, ref.current));
  };

  useEffect(() => () => clearTimeout(timer.current), []);
  // The card is placed once, so it goes away when the page moves under it.
  useEffect(() => {
    if (!open) return;
    const close = () => setPlace(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    const action = figureKey(e.key, open);
    if (action === "open") {
      e.preventDefault();
      openQuery();
    } else if (action === "close") {
      e.preventDefault(); // so the drawer, which also listens for Escape, stays where it is
      setPlace(null);
    }
  };

  const focusable = inspect;

  return (
    <>
      <span
        ref={ref}
        data-traced=""
        tabIndex={focusable ? 0 : -1}
        role={focusable && canOpen ? "button" : undefined}
        aria-label={focusable && canOpen ? figureLabel(figure) : undefined}
        aria-expanded={focusable && canOpen ? active : undefined}
        aria-controls={focusable && canOpen && active ? DRAWER_ID : undefined}
        aria-describedby={open ? `${id}-card` : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && show()}
        onPointerLeave={(e) => e.pointerType === "mouse" && hideSoon()}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && show()}
        onBlur={() => setPlace(null)}
        onClick={openQuery}
        onKeyDown={onKeyDown}
        className={`num rounded-[3px] underline decoration-brand decoration-dotted decoration-[1.5px] underline-offset-[3px] transition-colors hover:bg-brand-tint hover:decoration-solid [td_&]:decoration-1 [td_&]:decoration-brand/60 ${canOpen ? "cursor-pointer" : "cursor-default"} ${open || active ? "bg-brand-tint" : ""}`}
      >
        {children}
      </span>
      {place
        ? createPortal(
            <FigureCard id={`${id}-card`} figure={figure} place={place} viewportWidth={window.innerWidth} onOpen={canOpen ? openQuery : undefined} onEnter={keep} onLeave={hideSoon} />,
            document.body,
          )
        : null}
    </>
  );
}

// What react-markdown renders for a <traced-figure> element (see rehypeTraced): the figure's index arrives as data-figure.
export function TracedFigureSpan({ children, ...props }: { children?: ReactNode; "data-figure"?: string }) {
  const { figures, provenance } = useContext(TracedContext);
  const figure = figures[Number(props["data-figure"])];
  if (!figure) return <>{children}</>;
  return (
    <TracedSpan figure={figure} entry={provenance[figure.queryId]}>
      {children}
    </TracedSpan>
  );
}
