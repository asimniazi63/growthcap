// Money rules shared by the generator and truth (documented in types.ts). Integer cents throughout.

export function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/**
 * Split `total` cents across parts pro rata to `weights`: each part rounded half up, and the rounding
 * remainder put on the part with the largest weight (the first one on ties), so the parts sum to `total`.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const parts = weights.map((w) => roundHalfUp((total * w) / sum));
  const remainder = total - parts.reduce((s, p) => s + p, 0);
  if (remainder !== 0) {
    let heaviest = 0;
    weights.forEach((w, i) => {
      if (w > (weights[heaviest] ?? 0)) heaviest = i;
    });
    parts[heaviest] = (parts[heaviest] ?? 0) + remainder;
  }
  return parts;
}
