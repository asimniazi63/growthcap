// Seeded, keyed random streams. A stream is derived from the seed plus string keys, so a day's or an
// order's randomness never depends on how much was generated before it (this is what keeps history
// identical when --as-of moves).

export type Rng = () => number; // uniform in [0, 1)

function hash32(text: string): number {
  // FNV-1a, then a murmur-style finaliser so close keys give unrelated streams.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function makeRng(seed: number, ...keys: (string | number)[]): Rng {
  let a = hash32(`${seed}|${keys.join("|")}`);
  return () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexId(seed: number, ...keys: (string | number)[]): string {
  return hash32(`id|${seed}|${keys.join("|")}`).toString(16).padStart(8, "0");
}

export function poisson(r: Rng, lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= r();
  } while (p > limit && k < 200);
  return k - 1;
}

export function weightedIndex(r: Rng, weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let x = r() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    if (w <= 0) continue;
    if (x < w) return i;
    x -= w;
  }
  for (let i = weights.length - 1; i >= 0; i--) if ((weights[i] ?? 0) > 0) return i;
  throw new Error("weightedIndex: no positive weight");
}

export function intBetween(r: Rng, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}

export function chance(r: Rng, p: number): boolean {
  return r() < p;
}
