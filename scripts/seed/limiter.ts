// Evenly spaced rate limiter. Dev stores allow 5 created orders per minute, so at 5 per minute
// each call waits until 12 s after the previous slot. Safe for concurrent callers: slots are handed out in order.
export interface Limiter {
  acquire(): Promise<void>;
}

export interface LimiterOptions {
  perMinute: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createLimiter({ perMinute, now = Date.now, sleep = defaultSleep }: LimiterOptions): Limiter {
  const interval = 60_000 / perMinute;
  let nextSlot = 0;
  return {
    async acquire() {
      const t = now();
      const slot = Math.max(t, nextSlot);
      nextSlot = slot + interval;
      if (slot > t) await sleep(slot - t);
    },
  };
}

export const noLimit: Limiter = { acquire: async () => {} };
