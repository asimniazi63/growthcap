import { describe, expect, it } from "vitest";
import { chipClick, initialMapState, mapReducer } from "./map-state";

describe("mapReducer", () => {
  it("starts with every segment showing and nothing hovered or focused", () => {
    expect(initialMapState()).toEqual({ solo: null, hoverId: null, focusId: null, focused: false });
    expect(initialMapState("at_risk").solo).toBe("at_risk");
  });

  it("chooses a segment, and shows them all again with null", () => {
    const one = mapReducer(initialMapState(), { type: "solo", segment: "champions" });
    expect(one.solo).toBe("champions");
    expect(mapReducer(one, { type: "solo", segment: null }).solo).toBeNull();
  });

  it("drops the hover when the filter changes, because that dot may be gone", () => {
    const hovered = mapReducer(initialMapState(), { type: "hover", id: "CUST_a" });
    expect(mapReducer(hovered, { type: "solo", segment: "active" }).hoverId).toBeNull();
  });

  it("tracks the hover, the focused dot and whether the chart has the keyboard", () => {
    let s = initialMapState();
    s = mapReducer(s, { type: "hover", id: "CUST_a" });
    s = mapReducer(s, { type: "focus", id: "CUST_b" });
    s = mapReducer(s, { type: "focused", on: true });
    expect(s).toEqual({ solo: null, hoverId: "CUST_a", focusId: "CUST_b", focused: true });
  });

  it("returns the very same object when nothing changed, so React skips the render", () => {
    const s = mapReducer(mapReducer(initialMapState(), { type: "hover", id: "CUST_a" }), { type: "focus", id: "CUST_b" });
    expect(mapReducer(s, { type: "hover", id: "CUST_a" })).toBe(s);
    expect(mapReducer(s, { type: "focus", id: "CUST_b" })).toBe(s);
    expect(mapReducer(s, { type: "focused", on: false })).toBe(s);
    expect(mapReducer(s, { type: "solo", segment: null })).toBe(s);
  });
});

describe("chipClick: what a click on a legend chip does", () => {
  it("chooses the segment and sends the Top customers table to it", () => {
    expect(chipClick(null, "at_risk", "champions")).toEqual({ solo: "at_risk", href: "/segments?segment=at_risk" });
    expect(chipClick("champions", "one_and_done", "champions")).toEqual({ solo: "one_and_done", href: "/segments?segment=one_and_done" });
  });

  it("clicking the chosen chip again shows every segment and leaves the table alone", () => {
    expect(chipClick("at_risk", "at_risk", "at_risk")).toEqual({ solo: null, href: null });
  });

  it("does not reload the page when the table is already on that segment", () => {
    expect(chipClick(null, "champions", "champions")).toEqual({ solo: "champions", href: null });
  });

  it("filters Active without touching the table, since the table has no Active segment", () => {
    expect(chipClick(null, "active", "champions")).toEqual({ solo: "active", href: null });
  });
});
