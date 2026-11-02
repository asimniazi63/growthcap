// How the bundle matrix shades a cell. Neutral is a lift of 1.0 (the pair appears together about as often as chance), brand is
// above it and a grey is below it. The strength stops growing at LIFT_CAP, and the colour is mixed in only as far as the
// two MAX values below, so the weak lifts this data has (0.7 to 1.9) never read as strong.

export const LIFT_CAP = 2; // a lift at or above this is drawn at full strength
export const LIFT_FLOOR = 0.5; // a lift at or below this is drawn at full strength, in grey
const MAX_ABOVE = 42; // percent of the brand colour at full strength
const MAX_BELOW = 16; // percent of ink at full strength

// 0 for a lift of exactly 1, up to 1 at the cap or the floor.
export function liftStrength(lift: number): number {
  if (lift >= 1) return Math.min((lift - 1) / (LIFT_CAP - 1), 1);
  return Math.min((1 - lift) / (1 - LIFT_FLOOR), 1);
}

export function liftFill(lift: number): string {
  const s = liftStrength(lift);
  if (lift > 1) return `color-mix(in oklab, var(--color-brand) ${(s * MAX_ABOVE).toFixed(1)}%, var(--color-surface))`;
  if (lift < 1) return `color-mix(in oklab, var(--color-ink) ${(s * MAX_BELOW).toFixed(1)}%, var(--color-surface))`;
  return "var(--color-surface)";
}

// A pair with few orders is drawn with fine diagonal lines over its fill, so it reads as thin without relying on colour.
export const THIN_LINES = "repeating-linear-gradient(135deg, color-mix(in oklab, var(--color-ink) 30%, transparent) 0 1.5px, transparent 1.5px 5px)";

export const SCALE_FILLS = {
  low: liftFill(LIFT_FLOOR),
  mid: liftFill(1),
  high: liftFill(LIFT_CAP),
};
