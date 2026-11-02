// Geometry and keyboard rules for the timeline markers under the Pace chart. Pure, no DOM.

// Puts each marker (given by its x, left to right) on the first row where it clears the one before by `minGap`. When none does
// and the lane is at `maxRows`, it goes on the row whose last marker is furthest back (the one placed longest ago on a tie), so
// a crowd at one spot spreads over the rows instead of piling on one.
export function layoutMarkers(xs: readonly number[], minGap: number, maxRows = 4): { rows: number[]; rowCount: number } {
  const lastX: number[] = [];
  const placedAt: number[] = [];
  const rows = xs.map((x, n) => {
    let row = lastX.findIndex((last) => x - last >= minGap);
    if (row < 0) {
      if (lastX.length < maxRows) row = lastX.length;
      else row = lastX.reduce((best, last, r) => (last < lastX[best]! || (last === lastX[best] && placedAt[r]! < placedAt[best]!) ? r : best), 0);
    }
    lastX[row] = x;
    placedAt[row] = n;
    return row;
  });
  return { rows, rowCount: lastX.length };
}

// Arrow keys move between markers in date order; Home and End jump to the ends. Null for a key that is not ours, or when
// there is nowhere to go (the focus stays on the end marker instead of wrapping).
export function nextMarkerIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  let next: number;
  if (key === "ArrowRight" || key === "ArrowDown") next = current + 1;
  else if (key === "ArrowLeft" || key === "ArrowUp") next = current - 1;
  else if (key === "Home") next = 0;
  else if (key === "End") next = count - 1;
  else return null;
  return Math.min(count - 1, Math.max(0, next));
}
