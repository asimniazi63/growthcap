import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

// Whether the person asked their device for less motion. Read at the moment of asking, so a test can stand in a window.
export function reducedMotionNow(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

export function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

// False on the server, then the real answer once the page is live (React re-renders if they differ).
export const useReducedMotion = () => useSyncExternalStore(subscribeReducedMotion, reducedMotionNow, () => false);
