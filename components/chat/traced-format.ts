import type { TracedFigure } from "@/lib/agent/traced";
import { formatAsOf, formatPeriod } from "./when";

// The words around traced figures: the badge, and the source line of a card. Pure, so they can be checked on their own.

// "27 of 27 figures traced", or "24 of 27 figures traced, 3 not found".
export function badgeText(traced: number, total: number): string {
  const base = `${traced} of ${total} ${total === 1 ? "figure" : "figures"} traced`;
  return total > traced ? `${base}, ${total - traced} not found` : base;
}

export interface FigureSource {
  source: string;
  period: string | null;
  synced: string | null;
}

export function figureSource(figure: TracedFigure, now?: Date): FigureSource {
  return {
    source: figure.source,
    period: figure.range ? formatPeriod(figure.range) : null,
    synced: figure.asOf ? formatAsOf(figure.asOf, now) : null,
  };
}

// "$12,340 — from Sales metrics, September 1 to 30, 2026, synced October 31, 10:34 UTC"
export function figureSentence(figure: TracedFigure, now?: Date): string {
  const { source, period, synced } = figureSource(figure, now);
  return `${figure.text} — from ${[source, period, synced ? `synced ${synced}` : null].filter(Boolean).join(", ")}`;
}

// What a screen reader says for a figure that can be focused.
export function figureLabel(figure: TracedFigure, now?: Date): string {
  const { source, period, synced } = figureSource(figure, now);
  return `${figure.text}, from ${[source, period, synced ? `synced ${synced}` : null].filter(Boolean).join(", ")}. See the query.`;
}
