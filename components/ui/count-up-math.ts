// The pure parts of CountUp: the easing, the value at a moment, whether to animate at all, and a frame loop that takes its clock as
// an argument so a test can drive it. None of it touches the page.

export const COUNT_UP_MS = 700;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);

// The number to show `elapsedMs` into the count. Before the start it is 0, from the end on it is exactly the target (no float drift).
export function countUpValue(target: number, elapsedMs: number, durationMs = COUNT_UP_MS): number {
  if (!(durationMs > 0) || elapsedMs >= durationMs) return target;
  if (!(elapsedMs > 0)) return 0;
  return target * easeOutCubic(elapsedMs / durationMs);
}

export type CountUpPlan = "static" | "animate";

// Animate only when it can be seen to mean something: motion allowed, a way to tell when it scrolls into view, a number that is not
// 0 or broken, and not already played once. Everything else shows the final value as it is.
export function planCountUp(input: { reducedMotion: boolean; hasObserver: boolean; value: number; played: boolean }): CountUpPlan {
  if (input.reducedMotion || !input.hasObserver || input.played) return "static";
  if (!Number.isFinite(input.value) || input.value === 0) return "static";
  return "animate";
}

export function prefersReducedMotion(win: { matchMedia?: (query: string) => { matches: boolean } } | undefined): boolean {
  try {
    return win?.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

export interface FrameClock {
  now: () => number;
  request: (cb: () => void) => number;
  cancel: (id: number) => void;
}

// Calls `onFrame` with 0 at once, then with each eased value on every frame, ending on exactly `target`, then `onDone`. Returns a stop function.
export function runCountUp(target: number, onFrame: (value: number) => void, onDone: () => void, clock: FrameClock, durationMs = COUNT_UP_MS): () => void {
  const start = clock.now();
  let id = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const elapsed = clock.now() - start;
    onFrame(countUpValue(target, elapsed, durationMs));
    if (elapsed >= durationMs) onDone();
    else id = clock.request(tick);
  };
  onFrame(0);
  id = clock.request(tick);
  return () => {
    stopped = true;
    clock.cancel(id);
  };
}

export const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};
