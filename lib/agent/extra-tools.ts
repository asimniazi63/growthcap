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
// `singleAgent` leaves explain_gap out, so one agent answers "why" with the read tools alone. It exists for the evals, which
// compare the two (AGENT_SINGLE_AGENT=true), and is not a setting for the app.
export function buildExtraTools(d: ExtraToolDeps, opts: { singleAgent?: boolean } = {}): ToolSet {
  const gc = d.ctx.role !== "client_viewer";
  return {
    ...(opts.singleAgent ? {} : { explain_gap: buildExplainGapTool(d) }),
    ...(buildCalendarNotesTools(d) as ToolSet),
    ...(gc ? { propose_action: buildProposeActionTool(d), draft_landing_page: buildDraftLandingPageTool(d) } : {}),
  };
}

// The Why tools record their results by writing to `calls`. This map forwards each new one to the turn's own bookkeeping
// (the number checker's results, the provenance list), so a figure from explain_gap is checked like one from query_metric.
export function trackedCalls(calls: Map<string, TurnCall>, onResult: (queryId: string, call: TurnCall, isNew: boolean) => void): Map<string, TurnCall> {
  const tracked = new Map<string, TurnCall>();
  const set = tracked.set.bind(tracked);
  tracked.set = (queryId, call) => {
    onResult(queryId, call, !calls.has(queryId));
    calls.set(queryId, call);
    return set(queryId, call);
  };
  tracked.get = (queryId) => calls.get(queryId);
  return tracked;
}
