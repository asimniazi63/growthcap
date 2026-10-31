import type { ToolSet } from "ai";
import { buildProposeActionTool } from "../actions/tool";
import { buildDraftLandingPageTool } from "../landing/tool";
import { buildExplainGapTool } from "../why/explain";
import { buildCalendarNotesTools } from "../why/tools";
import type { ExtraToolDeps } from "./extra-types";
import type { TurnCall } from "./view-tools";

// The tools added in the stretch tickets (Why, Act, landing pages), built per turn like render_view and remember.
// Growth Capital roles get the calendar and call notes, and may ask for a change or a landing page; a client viewer gets
// only explain_gap, which then uses store data alone.
export function buildExtraTools(d: ExtraToolDeps): ToolSet {
  const gc = d.ctx.role !== "client_viewer";
  return {
    explain_gap: buildExplainGapTool(d),
    ...(buildCalendarNotesTools(d) as ToolSet),
    ...(gc ? { propose_action: buildProposeActionTool(d), draft_landing_page: buildDraftLandingPageTool(d) } : {}),
  };
}

// The Why tools record their results by writing to `calls`. This map forwards each new one to the turn's own bookkeeping
// (the number checker's results, the provenance list), so a figure from explain_gap is checked like one from query_metric.
export function trackedCalls(calls: Map<string, TurnCall>, onNew: (queryId: string, call: TurnCall) => void): Map<string, TurnCall> {
  const tracked = new Map<string, TurnCall>();
  const set = tracked.set.bind(tracked);
  tracked.set = (queryId, call) => {
    if (!calls.has(queryId)) onNew(queryId, call);
    calls.set(queryId, call);
    return set(queryId, call);
  };
  tracked.get = (queryId) => calls.get(queryId);
  return tracked;
}
