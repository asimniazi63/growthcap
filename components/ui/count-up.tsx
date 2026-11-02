"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MetricUnit } from "@/lib/metrics/registry";
import { formatUnit } from "@/lib/pace/format";
import { browserClock, planCountUp, prefersReducedMotion, runCountUp } from "./count-up-math";

// useLayoutEffect warns on the server in older React; this runs before paint in the browser and is quiet on the server.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// A headline figure that counts up from 0 the first time it scrolls into view. The server HTML and the reduced-motion case carry the
// final value, so nothing flashes a zero and a screen reader only ever hears the final number. The width is reserved by a hidden
// copy of the final text, so the page does not shift while the digits change. It formats with the same function as the static text.
export function CountUp({ value, unit, currency = "USD", align = "start", className }: { value: number; unit: MetricUnit; currency?: string; align?: "start" | "end"; className?: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const played = useRef(false);
  const [anim, setAnim] = useState<{ for: number; shown: number } | null>(null); // the number on its way up; null shows the final one
  const final = formatUnit(unit, value, currency);
  const shown = anim && anim.for === value ? anim.shown : value;

  useIsoLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const plan = planCountUp({ reducedMotion: prefersReducedMotion(window), hasObserver: typeof IntersectionObserver !== "undefined", value, played: played.current });
    if (plan === "static") return;
    // Start from 0 before the first paint, so the figure never shows its final value and then drops.
    setAnim({ for: value, shown: 0 });
    let stop = () => {};
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        played.current = true;
        stop = runCountUp(value, (v) => setAnim({ for: value, shown: v }), () => setAnim(null), browserClock);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      stop();
    };
  }, [value]);

  return (
    <span ref={root} className={`num relative inline-grid whitespace-nowrap ${align === "end" ? "justify-items-end" : "justify-items-start"} ${className ?? ""}`}>
      <span aria-hidden className="invisible col-start-1 row-start-1 select-none">
        {final}
      </span>
      <span aria-hidden className="col-start-1 row-start-1">
        {shown === value ? final : formatUnit(unit, shown, currency)}
      </span>
      <span className="sr-only">{final}</span>
    </span>
  );
}
