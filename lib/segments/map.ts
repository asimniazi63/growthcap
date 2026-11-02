import { SEGMENT_IDS, SEGMENT_RULES, SEGMENTS, type SegmentCustomer, type SegmentId, type SegmentOrActive } from "./definitions";

// The pure side of the customer map on the Segments page: what the page hands the browser, the two axes, the marks, and the nearest-dot
// searches the pointer and the arrow keys use. No React, no database, no clock; the component only draws what these return.

// ---- What the page hands the browser

// Only what the map shows. The page strips everything else (dates, scores) before the array crosses to the client.
export interface MapPoint {
  id: string; // pseudonymous customer id
  orders: number;
  ltvCents: number;
  daysSinceLast: number;
  churnRisk: number; // a fraction, 0 to 1
  segment: SegmentOrActive;
}

export const toMapPoints = (customers: SegmentCustomer[]): MapPoint[] =>
  customers.map((c) => ({ id: c.customerId, orders: c.orders, ltvCents: c.ltvCents, daysSinceLast: c.daysSinceLast, churnRisk: c.churnRisk, segment: c.segment }));

export const MAP_SEGMENT_IDS: SegmentOrActive[] = [...SEGMENT_IDS, "active"];
export const ACTIVE_TITLE = "Active";
export const segmentTitle = (id: SegmentOrActive): string => (id === "active" ? ACTIVE_TITLE : (SEGMENTS.find((s) => s.id === id)?.title ?? id));

// The ids in the table for a segment, in the table's own order (lifetime value first, then id, as format.ts topCustomers).
export function listedIds(points: MapPoint[], segment: SegmentId, n: number): Set<string> {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const rows = points.filter((p) => p.segment === segment).sort((a, b) => b.ltvCents - a.ltvCents || cmp(a.id, b.id));
  return new Set(rows.slice(0, n).map((p) => p.id));
}

// ---- Marks: five segments, five shapes, so the colour is never the only way to tell them apart

export type MarkShape = "circle" | "triangle" | "diamond" | "square" | "cross";

export const SEGMENT_SHAPE: Record<SegmentOrActive, MarkShape> = {
  champions: "circle",
  at_risk: "triangle",
  due_to_reorder: "diamond",
  one_and_done: "square",
  active: "cross",
};

// Drawn first to last, so the muted majority is at the back and the segments worth acting on are never buried under it.
export const DRAW_ORDER: SegmentOrActive[] = ["active", "one_and_done", "due_to_reorder", "at_risk", "champions"];

const f = (n: number) => Number(n.toFixed(2));

// A path for one mark centred on (cx, cy). Every shape is sized to cover about the same area as a circle of radius r, so no segment
// looks bigger than another. The cross is two strokes, not a fill.
export function markPath(shape: MarkShape, cx: number, cy: number, r: number): string {
  switch (shape) {
    case "circle":
      return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0Z`;
    case "square": {
      const h = r * 0.886;
      return `M${f(cx - h)} ${f(cy - h)}h${f(2 * h)}v${f(2 * h)}h${f(-2 * h)}Z`;
    }
    case "diamond": {
      const d = r * 1.2533;
      return `M${f(cx)} ${f(cy - d)}L${f(cx + d)} ${f(cy)}L${f(cx)} ${f(cy + d)}L${f(cx - d)} ${f(cy)}Z`;
    }
    case "triangle": {
      const side = r * 2.69;
      const h = side * 0.866;
      return `M${f(cx)} ${f(cy - (2 * h) / 3)}L${f(cx + side / 2)} ${f(cy + h / 3)}L${f(cx - side / 2)} ${f(cy + h / 3)}Z`;
    }
    case "cross": {
      const a = r * 1.15;
      return `M${f(cx - a)} ${f(cy)}h${f(2 * a)}M${f(cx)} ${f(cy - a)}v${f(2 * a)}`;
    }
  }
}

// ---- Axes

const sortedAsc = (values: number[]) => [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
const middle = (sorted: number[]) => (sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? sorted[sorted.length >> 1]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2);

// Lifetime value runs up the chart on a "linear near zero, then compressing" scale: height is ln(1 + value / knee). Typical customers get
// most of the height and a customer worth thirty times the median still fits without flattening everyone else, which a straight scale
// (all the dots in the bottom few pixels) or a square root (still squashed) would do. Zero and negative values (refunds can leave a
// customer under zero) sit on the baseline, which a pure log scale could not draw. Always computed from every customer, never from the
// ones a filter leaves visible, so choosing a segment never moves a dot.
export interface LtvScale {
  toUnit(cents: number): number; // 0 at the baseline, 1 at `top`
  top: number; // cents at the top of the axis: the biggest customer plus a little headroom
  knee: number; // cents below which the scale is close to straight
}

const KNEE_OF_MEDIAN = 0.5;
const HEADROOM = 1.1;
const MIN_KNEE_CENTS = 100;
const EMPTY_TOP_CENTS = 10_000;

export function makeLtvScale(values: number[]): LtvScale {
  const positive = sortedAsc(values).filter((v) => v > 0);
  const max = positive.length ? positive[positive.length - 1]! : 0;
  const top = max > 0 ? max * HEADROOM : EMPTY_TOP_CENTS;
  const knee = Math.max(MIN_KNEE_CENTS, middle(positive) * KNEE_OF_MEDIAN);
  const span = Math.log1p(top / knee);
  return {
    top,
    knee,
    toUnit: (cents) => (Number.isFinite(cents) && cents > 0 ? Math.min(1, Math.log1p(cents / knee) / span) : 0),
  };
}

// Round-dollar tick values (1, 2 and 5 times a power of ten) from the baseline up, skipping any that would crowd the one before.
export function ltvTicks(scale: LtvScale, plotHeightPx: number, minGapPx = 26): number[] {
  const ticks = [0];
  let last = 0;
  for (let exp = 0; exp <= 12; exp++) {
    for (const m of [1, 2, 5]) {
      const cents = m * 10 ** exp * 100;
      if (cents > scale.top) return ticks;
      const u = scale.toUnit(cents);
      if ((u - last) * plotHeightPx >= minGapPx) {
        ticks.push(cents);
        last = u;
      }
    }
  }
  return ticks;
}

// Days since the last order run left to right on a square-root scale: stretched near zero, where the customers that matter most to act on
// sit, and compressed for the long tail. Most recent on the left.
export interface DaysScale {
  toUnit(days: number): number; // 0 at the left edge, 1 at `top`
  top: number; // days at the right edge
}

const DAYS_STEP = 30;

export function makeDaysScale(values: number[]): DaysScale {
  const max = sortedAsc(values).reduce((m, v) => Math.max(m, v), 0);
  const top = Math.max(DAYS_STEP, Math.ceil(max / DAYS_STEP) * DAYS_STEP);
  return { top, toUnit: (days) => (Number.isFinite(days) ? Math.sqrt(Math.min(top, Math.max(0, days)) / top) : 0) };
}

// The day counts the segment rules turn on, read from the rules themselves (so a changed rule moves its line): one and done begins,
// champions end, at risk ends. Due to reorder has none, because it compares each customer with their own usual gap.
export interface RuleGuide {
  days: number;
  note: string; // plain words for the caption
}

export interface GuideRules {
  oneAndDone: { minDaysSinceLast: number };
  champions: { maxDaysSinceLast: number };
  atRisk: { maxDaysSinceLast: number };
}

export function ruleGuides(rules: GuideRules = SEGMENT_RULES): RuleGuide[] {
  const guides: RuleGuide[] = [
    { days: rules.oneAndDone.minDaysSinceLast, note: `${rules.oneAndDone.minDaysSinceLast} days (one and done starts)` },
    { days: rules.champions.maxDaysSinceLast, note: `${rules.champions.maxDaysSinceLast} days (champions end)` },
    { days: rules.atRisk.maxDaysSinceLast, note: `${rules.atRisk.maxDaysSinceLast} days (at risk ends)` },
  ];
  return guides
    .sort((a, b) => a.days - b.days)
    .filter((g, i, all) => i === 0 || g.days !== all[i - 1]!.days);
}

const DAY_LADDER = [30, 90, 180, 365, 730, 1095, 1460, 1825, 2555, 3650];

// Where the days axis is labelled: the start, every rule day, and the round steps that are not crowding one of those.
export function daysTicks(scale: DaysScale, guideDays: number[], plotWidthPx: number, minGapPx = 34): number[] {
  const kept = [0, ...guideDays.filter((d) => d > 0 && d <= scale.top)];
  const at = (d: number) => scale.toUnit(d) * plotWidthPx;
  for (const d of DAY_LADDER) {
    if (d > scale.top) break;
    if (kept.every((k) => Math.abs(at(d) - at(k)) >= minGapPx)) kept.push(d);
  }
  return [...new Set(kept)].sort((a, b) => a - b);
}

// How each axis label sits on its tick. Two labels closer than minGap would run into each other, so the left one is set to end at its tick
// and the right one to start at it, which keeps the pair apart however close the ticks are. A label with room around it is centred.
export function labelAnchors(positions: number[], minGap: number): ("start" | "middle" | "end")[] {
  return positions.map((x, i) => {
    const crowdedLeft = i > 0 && x - positions[i - 1]! < minGap;
    const crowdedRight = i < positions.length - 1 && positions[i + 1]! - x < minGap;
    return crowdedLeft && !crowdedRight ? "start" : crowdedRight && !crowdedLeft ? "end" : "middle";
  });
}

// ---- Placing the marks

export interface Frame {
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  x(days: number): number;
  y(cents: number): number;
  ltv: LtvScale;
  days: DaysScale;
}

export const MARK_RADIUS = 3.5;
const EDGE_PAD = MARK_RADIUS + 3; // a mark on the baseline or the edge is drawn whole

export interface Scales {
  ltv: LtvScale;
  days: DaysScale;
}

// Both axes come from every customer, so a filter never moves a dot.
export const makeScales = (points: Pick<MapPoint, "ltvCents" | "daysSinceLast">[]): Scales => ({
  ltv: makeLtvScale(points.map((p) => p.ltvCents)),
  days: makeDaysScale(points.map((p) => p.daysSinceLast)),
});

// `margin` is the space kept free on each side of the plot for the axis labels.
export function makeFrame(scales: Scales, size: { width: number; height: number }, margin: { left: number; top: number; right: number; bottom: number }): Frame {
  const { ltv, days } = scales;
  const left = margin.left;
  const right = size.width - margin.right;
  const top = margin.top;
  const bottom = size.height - margin.bottom;
  const innerW = Math.max(1, right - left - 2 * EDGE_PAD);
  const innerH = Math.max(1, bottom - top - 2 * EDGE_PAD);
  return {
    ...size,
    left,
    top,
    right,
    bottom,
    ltv,
    days,
    x: (d) => left + EDGE_PAD + days.toUnit(d) * innerW,
    y: (c) => bottom - EDGE_PAD - ltv.toUnit(c) * innerH,
  };
}

export interface Placed {
  id: string;
  x: number;
  y: number;
  segment: SegmentOrActive;
  d: string; // the path of the mark
}

// Every customer placed and in drawing order. The same input and frame always give the same marks.
export function placeMarks(points: MapPoint[], frame: Frame, r = MARK_RADIUS): Placed[] {
  const rank = new Map(DRAW_ORDER.map((s, i) => [s, i]));
  return [...points]
    .sort((a, b) => rank.get(a.segment)! - rank.get(b.segment)! || a.ltvCents - b.ltvCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => {
      const x = frame.x(p.daysSinceLast);
      const y = frame.y(p.ltvCents);
      return { id: p.id, x, y, segment: p.segment, d: markPath(SEGMENT_SHAPE[p.segment], x, y, r) };
    });
}

// ---- Finding a dot from the pointer or the keyboard

type Spot = { id: string; x: number; y: number };

// The closest dot to a point, if it is within maxDist. A dot you have to land on dead centre is a pinpoint, so the pointer only has to be closest.
export function nearestMark<T extends Spot>(marks: T[], x: number, y: number, maxDist = Infinity): T | null {
  let best: T | null = null;
  let bestD = maxDist * maxDist;
  for (const m of marks) {
    const d = (m.x - x) ** 2 + (m.y - y) ** 2;
    if (d < bestD || (d === bestD && best !== null && m.id < best.id)) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

export type Direction = "left" | "right" | "up" | "down";

// The next dot when an arrow key is pressed: the nearest one in that direction, with a sideways offset counting double so the focus stays
// roughly in its row or column. Dots drawn on exactly the same spot cannot be told apart by position, so right and down step through them
// in id order and left and up step back, which keeps every dot reachable. null when nothing lies that way.
export function nextInDirection<T extends Spot>(marks: T[], fromId: string, dir: Direction): T | null {
  const from = marks.find((m) => m.id === fromId);
  if (!from) return null;
  const forward = dir === "right" || dir === "down";
  let best: T | null = null;
  let bestScore = Infinity;
  for (const m of marks) {
    if (m.id === from.id) continue;
    const dx = m.x - from.x;
    const dy = m.y - from.y;
    let score: number;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
      if (forward ? m.id < from.id : m.id > from.id) continue;
      score = 0.001; // beats every dot that is not on the spot; ties go to the nearest id below
    } else {
      const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
      const across = dir === "left" || dir === "right" ? dy : dx;
      if (along <= 0.01) continue;
      score = along + 2 * Math.abs(across);
    }
    if (score < bestScore || (score === bestScore && best !== null && (forward ? m.id < best.id : m.id > best.id))) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

// The leftmost (most recent) or rightmost dot, for Home and End.
export function edgeMark<T extends Spot>(marks: T[], side: "left" | "right"): T | null {
  let best: T | null = null;
  for (const m of marks) {
    if (best === null || (side === "left" ? m.x < best.x : m.x > best.x) || (m.x === best.x && m.id < best.id)) best = m;
  }
  return best;
}
