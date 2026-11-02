import type { PlanGap } from "../pace/gap";

// "Plan hit" means the month's net sales so far have reached the month's TARGET, not just the plan to date. The gap says so itself
// (targetMet) while the month runs; the actual-against-target check covers a gap that does not carry the flag.
export function isPlanHit(gap: Pick<PlanGap, "target" | "actual" | "targetMet"> | null | undefined): boolean {
  if (!gap) return false;
  if (gap.targetMet === true) return true;
  return gap.target > 0 && gap.actual >= gap.target;
}

// "Plan hit for October" from "2026-10".
export function planHitLabel(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const name = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  return `Plan hit for ${name}`;
}

export const planHitKey = (scope: string, month: string) => `oasis:plan-hit:${scope}:${month}`;

export interface SessionStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// True the first time this key is seen in the session, and false after, so the celebration plays once. If the browser will not let the
// page read or write session storage, nothing can be remembered, so it does not play (a replay on every visit is worse than none).
export function firstSightThisSession(store: SessionStore | null | undefined, key: string): boolean {
  try {
    if (!store || store.getItem(key) !== null) return false;
    store.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}
