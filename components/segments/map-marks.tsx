import { memo } from "react";
import { markPath, SEGMENT_SHAPE, type Placed } from "@/lib/segments/map";
import type { SegmentOrActive } from "@/lib/segments/definitions";

// How each segment is drawn on the customer map: a colour from the theme tokens and its own shape. Five segments are more hues than anyone
// can reliably tell apart (and the status colours were not made as a five-colour set), so the shape carries the identity and the colour is
// the second cue. A dot is partly see-through, so where dots overlap the colour deepens and density shows. The "active" majority is a muted
// cross at the back. Written out in full so Tailwind can see every class.
export const MARK_CLASS: Record<SegmentOrActive, string> = {
  champions: "fill-ahead/50 stroke-ahead/90",
  at_risk: "fill-behind/50 stroke-behind/90",
  due_to_reorder: "fill-warn/50 stroke-warn/90",
  one_and_done: "fill-ink/40 stroke-ink/80",
  active: "fill-none stroke-ink-3/70",
};

// The same marks at full strength, for the legend and the selected dot.
export const GLYPH_CLASS: Record<SegmentOrActive, string> = {
  champions: "fill-ahead stroke-ahead",
  at_risk: "fill-behind stroke-behind",
  due_to_reorder: "fill-warn stroke-warn",
  one_and_done: "fill-ink stroke-ink",
  active: "fill-none stroke-ink-3",
};

export const strokeWidthOf = (segment: SegmentOrActive): number => (segment === "active" ? 1.6 : 1);

// One segment's mark, for the legend and the hover card.
export function Glyph({ segment, size = 14, className }: { segment: SegmentOrActive; size?: number; className?: string }) {
  const half = size / 2;
  return (
    <svg width={size} height={size} viewBox={`${-half} ${-half} ${size} ${size}`} aria-hidden focusable="false" className="shrink-0">
      <path d={markPath(SEGMENT_SHAPE[segment], 0, 0, size * 0.29)} className={className ?? GLYPH_CLASS[segment]} strokeWidth={segment === "active" ? 1.6 : 1.2} strokeLinecap="round" />
    </svg>
  );
}

// Every dot. Memoised on the list of marks alone, so moving the pointer, the focus ring or the selection (which live outside it) never
// redraws the hundreds of dots; only a new width, a new filter or new data does.
export const Dots = memo(function Dots({ marks }: { marks: Placed[] }) {
  return (
    <g aria-hidden>
      {marks.map((m) => (
        <path key={m.id} d={m.d} className={MARK_CLASS[m.segment]} strokeWidth={strokeWidthOf(m.segment)} strokeLinecap="round" />
      ))}
    </g>
  );
});
