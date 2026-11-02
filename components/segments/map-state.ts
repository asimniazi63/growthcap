import type { SegmentId, SegmentOrActive } from "@/lib/segments/definitions";

// The map's own state. Which customer is selected lives in the selection context instead, because the Top customers table reads it too.
export interface MapState {
  solo: SegmentOrActive | null; // the one segment whose dots are shown; null shows all five
  hoverId: string | null;
  focusId: string | null; // the dot the arrow keys have reached
  focused: boolean; // the chart has the keyboard, so the focus ring is drawn
}

export type MapAction =
  | { type: "solo"; segment: SegmentOrActive | null }
  | { type: "hover"; id: string | null }
  | { type: "focus"; id: string | null }
  | { type: "focused"; on: boolean };

export const initialMapState = (solo: SegmentOrActive | null = null): MapState => ({ solo, hoverId: null, focusId: null, focused: false });

// Returns the same object when nothing changes, so moving the pointer over empty space or the same dot costs no render.
export function mapReducer(state: MapState, action: MapAction): MapState {
  switch (action.type) {
    case "solo":
      return state.solo === action.segment ? state : { ...state, solo: action.segment, hoverId: null };
    case "hover":
      return state.hoverId === action.id ? state : { ...state, hoverId: action.id };
    case "focus":
      return state.focusId === action.id ? state : { ...state, focusId: action.id };
    case "focused":
      return state.focused === action.on ? state : { ...state, focused: action.on };
  }
}

// What a click on a legend chip does: choosing the chosen segment again shows all five. Choosing one of the four table segments also
// moves the Top customers table to it (the page reads ?segment=); Active has no table, and a table already on that segment stays put.
export function chipClick(solo: SegmentOrActive | null, clicked: SegmentOrActive, listed: SegmentId): { solo: SegmentOrActive | null; href: string | null } {
  if (solo === clicked) return { solo: null, href: null };
  return { solo: clicked, href: clicked === "active" || clicked === listed ? null : `/segments?segment=${clicked}` };
}
