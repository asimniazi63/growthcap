"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nextStick, type ScrollMetrics } from "./follow-scroll";

// Keeps a streaming conversation scrolled to its newest text, unless the reader has scrolled up. `scroller` goes on the list that
// scrolls on large screens (on small screens the page itself scrolls, so the hook watches that too) and `end` on an empty element
// after the last message. Call `nudge` when the messages change, `resume` when the reader asks something new or presses the button.
export function useFollowScroll() {
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const prevTop = useRef(0);
  const [away, setAway] = useState(false);

  const setStick = useCallback((on: boolean) => {
    stick.current = on;
    setAway(!on);
  }, []);

  const toEnd = useCallback(() => end.current?.scrollIntoView({ block: "end", behavior: "auto" }), []);

  const nudge = useCallback(() => {
    if (stick.current) toEnd();
  }, [toEnd]);

  const resume = useCallback(() => {
    setStick(true);
    toEnd();
  }, [setStick, toEnd]);

  useEffect(() => {
    // The list scrolls only where it has its own overflow; otherwise the document does.
    const metrics = (): ScrollMetrics => {
      const el = scroller.current;
      if (el && el.scrollHeight > el.clientHeight && getComputedStyle(el).overflowY !== "visible") return el;
      return document.scrollingElement ?? document.documentElement;
    };
    prevTop.current = metrics().scrollTop;
    const onScroll = (e: Event) => {
      if (e.target !== scroller.current && e.target !== document) return; // a scroll somewhere else on the page is not the conversation
      const m = metrics();
      const on = nextStick(stick.current, prevTop.current, m);
      prevTop.current = m.scrollTop;
      if (on !== stick.current) setStick(on);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [setStick]);

  return { scroller, end, away, nudge, resume };
}
