import { describe, expect, it } from "vitest";
import { COUNT_UP_MS, countUpValue, easeOutCubic, planCountUp, prefersReducedMotion, runCountUp, type FrameClock } from "./count-up-math";

describe("the count-up maths", () => {
  it("eases out: starts at 0, ends at 1, is quick at first and slow at the end", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(0.9) - easeOutCubic(0.8)).toBeLessThan(easeOutCubic(0.2) - easeOutCubic(0.1));
    expect(easeOutCubic(-3)).toBe(0);
    expect(easeOutCubic(7)).toBe(1);
  });

  it("is 0 before the start, climbs monotonically and lands on exactly the target", () => {
    expect(countUpValue(1_234_567, -50)).toBe(0);
    expect(countUpValue(1_234_567, 0)).toBe(0);
    let last = 0;
    for (let ms = 50; ms < COUNT_UP_MS; ms += 50) {
      const v = countUpValue(1_234_567, ms);
      expect(v).toBeGreaterThan(last);
      expect(v).toBeLessThan(1_234_567);
      last = v;
    }
    expect(countUpValue(1_234_567, COUNT_UP_MS)).toBe(1_234_567);
    expect(countUpValue(1_234_567, COUNT_UP_MS * 5)).toBe(1_234_567);
  });

  it("works for rates, fractions and negative targets", () => {
    expect(countUpValue(0.4321, COUNT_UP_MS)).toBe(0.4321);
    expect(countUpValue(-5000, COUNT_UP_MS / 2)).toBeLessThan(0);
    expect(countUpValue(-5000, COUNT_UP_MS / 2)).toBeGreaterThan(-5000);
  });

  it("goes straight to the target when the duration is nothing", () => {
    expect(countUpValue(99, 10, 0)).toBe(99);
  });
});

describe("planCountUp", () => {
  const base = { reducedMotion: false, hasObserver: true, value: 120_000, played: false };
  it("animates a real number the first time", () => {
    expect(planCountUp(base)).toBe("animate");
  });
  it("shows the final value, with no animation, under reduced motion", () => {
    expect(planCountUp({ ...base, reducedMotion: true })).toBe("static");
  });
  it("stays static without an observer, after it has played, and for 0 or a broken number", () => {
    expect(planCountUp({ ...base, hasObserver: false })).toBe("static");
    expect(planCountUp({ ...base, played: true })).toBe("static");
    expect(planCountUp({ ...base, value: 0 })).toBe("static");
    expect(planCountUp({ ...base, value: Number.NaN })).toBe("static");
    expect(planCountUp({ ...base, value: Number.POSITIVE_INFINITY })).toBe("static");
  });
});

describe("prefersReducedMotion", () => {
  it("reads the media query", () => {
    expect(prefersReducedMotion({ matchMedia: (q) => ({ matches: q.includes("reduce") }) })).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });
  it("is false when there is no window, no matchMedia, or it throws", () => {
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error("nope");
        },
      }),
    ).toBe(false);
  });
});

function fakeClock() {
  let t = 1000;
  let next = 1;
  const queue = new Map<number, () => void>();
  const clock: FrameClock = {
    now: () => t,
    request: (cb) => {
      queue.set(next, cb);
      return next++;
    },
    cancel: (id) => void queue.delete(id),
  };
  const frame = (advance: number) => {
    t += advance;
    const cbs = [...queue.values()];
    queue.clear();
    for (const cb of cbs) cb();
  };
  return { clock, frame, pending: () => queue.size };
}

describe("runCountUp", () => {
  it("starts at 0, passes through eased values and ends on the target exactly once", () => {
    const { clock, frame, pending } = fakeClock();
    const seen: number[] = [];
    let done = 0;
    runCountUp(1000, (v) => seen.push(v), () => done++, clock);
    expect(seen).toEqual([0]);
    frame(16);
    frame(300);
    frame(300);
    expect(seen.length).toBe(4);
    expect(seen.slice(1).every((v, i, a) => v > 0 && v < 1000 && (i === 0 || v > a[i - 1]!))).toBe(true);
    expect(done).toBe(0);
    frame(200);
    expect(seen.at(-1)).toBe(1000);
    expect(done).toBe(1);
    expect(pending()).toBe(0);
    frame(16);
    expect(done).toBe(1);
  });

  it("stops when asked and sends nothing more", () => {
    const { clock, frame, pending } = fakeClock();
    const seen: number[] = [];
    const stop = runCountUp(1000, (v) => seen.push(v), () => undefined, clock);
    frame(100);
    const n = seen.length;
    stop();
    expect(pending()).toBe(0);
    frame(100);
    expect(seen.length).toBe(n);
  });
});
