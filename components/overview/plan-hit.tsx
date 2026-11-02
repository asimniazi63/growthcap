"use client";

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/components/ui/count-up-math";
import { firstSightThisSession, planHitKey, planHitLabel } from "@/lib/overview/plan-hit";

// A quiet badge for a brand that has reached the month's net sales target: a ring and a tick, and the words. The first time it is on
// screen in a browser session the ring and tick draw themselves (about 0.9 s); after that, and under reduced motion, it is just the
// finished badge. The play is switched on with a data attribute set straight on the element, so no re-render can replay it.
export function PlanHit({ month, scope }: { month: string; scope: string }) {
  const badge = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = badge.current;
    if (!el || prefersReducedMotion(window) || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        let store: Storage | null = null;
        try {
          store = window.sessionStorage;
        } catch {
          // blocked: the badge stays still
        }
        if (firstSightThisSession(store, planHitKey(scope, month))) el.dataset.play = "true";
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scope, month]);

  return (
    <span ref={badge} className="plan-hit badge badge-ahead">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx={12} cy={12} r={9.5} pathLength={1} transform="rotate(-90 12 12)" className="plan-hit-ring" />
        <path d="M7.7 12.5l3 3 5.6-6" pathLength={1} className="plan-hit-tick" />
      </svg>
      {planHitLabel(month)}
    </span>
  );
}
