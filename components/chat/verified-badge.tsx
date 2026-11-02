"use client";

import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useContext, type ReactNode } from "react";
import type { ProvenanceEntry } from "@/lib/agent/run";
import type { TracedFigure } from "@/lib/agent/traced";
import { DRAWER_ID, ProofDrawerContext, type FigureListTarget } from "./proof-drawer";
import { badgeText } from "./traced-format";

// The line at the end of an answer that says how many of its figures were traced to the store data. It is a button: pressing it
// opens the list of those figures in the proof drawer. An answer with no figures has nothing to say, so it shows nothing.

export interface BadgeProps {
  traced: number; // figures the checker matched to a tool result
  total: number; // matched plus not found
  figures: TracedFigure[];
  provenance: Record<string, ProvenanceEntry>;
  unmatched: string[]; // the text of each figure that was not found
}

// What the drawer is given when the badge is pressed.
export function listTarget(props: BadgeProps, trigger: HTMLElement | null): FigureListTarget {
  return { figures: props.figures, provenance: props.provenance, traced: props.traced, total: props.total, unmatched: props.unmatched, trigger };
}

function ListButton({ props, className, children }: { props: BadgeProps; className: string; children: ReactNode }) {
  const drawer = useContext(ProofDrawerContext);
  if (!drawer) return <span className={className}>{children}</span>;
  const listOpen = drawer.list !== null && drawer.list.figures === props.figures; // the drawer is shared by every answer on the page
  return (
    <button
      type="button"
      aria-expanded={listOpen}
      aria-controls={listOpen ? DRAWER_ID : undefined}
      onClick={(e) => drawer.openList(listTarget(props, e.currentTarget))}
      className={`cursor-pointer ${className}`}
    >
      {children}
    </button>
  );
}

export function VerifiedBadge(props: BadgeProps) {
  const { traced, total, unmatched } = props;
  if (total === 0) return null;

  if (traced === total) {
    return (
      <p>
        <ListButton props={props} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-medium leading-4 text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
          <ShieldCheck className="size-3.5 shrink-0 text-brand-strong" aria-hidden />
          {badgeText(traced, total)}
        </ListButton>
      </p>
    );
  }

  // Some figures were not found: the same warning as before, with the count in front of the figures it names.
  return (
    <div role="status" className="max-w-[70ch] rounded-xl border border-warn/30 bg-warn-tint px-3.5 py-3 text-sm leading-6 text-ink">
      <p className="flex items-start gap-2.5">
        <TriangleAlert className="mt-1 size-4 shrink-0 text-warn" aria-hidden />
        <span>
          <ListButton props={props} className="rounded-sm text-left font-semibold underline decoration-warn underline-offset-2 hover:decoration-2">
            {badgeText(traced, total)}
          </ListButton>
          <br />
          Couldn&apos;t verify: {unmatched.join(", ")}. Treat {unmatched.length === 1 ? "that number" : "those numbers"} with care.
        </span>
      </p>
    </div>
  );
}
