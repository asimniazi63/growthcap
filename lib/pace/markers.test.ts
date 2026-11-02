import { describe, expect, it } from "vitest";
import { layoutMarkers, nextMarkerIndex } from "./markers";

describe("layoutMarkers", () => {
  it("keeps markers that clear each other on one row", () => {
    expect(layoutMarkers([10, 40, 80], 22)).toEqual({ rows: [0, 0, 0], rowCount: 1 });
  });

  it("moves a marker that is too close to the one before onto the next row, then back to the first when there is room", () => {
    expect(layoutMarkers([10, 20, 30, 70], 22)).toEqual({ rows: [0, 1, 2, 0], rowCount: 3 });
  });

  it("never opens more rows than the limit: a crowded marker takes the row whose last marker is furthest back", () => {
    const { rows, rowCount } = layoutMarkers([10, 10, 10, 10, 10], 22, 3);
    expect(rowCount).toBe(3);
    expect(rows).toEqual([0, 1, 2, 0, 1]);
    expect(layoutMarkers([10, 10, 10, 10, 10], 22).rowCount).toBe(4); // four rows is the default limit
  });

  it("has no rows for no markers", () => {
    expect(layoutMarkers([], 22)).toEqual({ rows: [], rowCount: 0 });
  });
});

describe("nextMarkerIndex: arrow keys along the markers in date order", () => {
  it("moves one marker with the arrows, and to the ends with Home and End", () => {
    expect(nextMarkerIndex("ArrowRight", 1, 5)).toBe(2);
    expect(nextMarkerIndex("ArrowDown", 1, 5)).toBe(2);
    expect(nextMarkerIndex("ArrowLeft", 1, 5)).toBe(0);
    expect(nextMarkerIndex("ArrowUp", 1, 5)).toBe(0);
    expect(nextMarkerIndex("Home", 3, 5)).toBe(0);
    expect(nextMarkerIndex("End", 1, 5)).toBe(4);
  });

  it("stays on the first and last marker rather than wrapping", () => {
    expect(nextMarkerIndex("ArrowLeft", 0, 5)).toBe(0);
    expect(nextMarkerIndex("ArrowRight", 4, 5)).toBe(4);
  });

  it("ignores other keys and an empty list", () => {
    expect(nextMarkerIndex("Tab", 1, 5)).toBeNull();
    expect(nextMarkerIndex("a", 1, 5)).toBeNull();
    expect(nextMarkerIndex("ArrowRight", 0, 0)).toBeNull();
  });
});
