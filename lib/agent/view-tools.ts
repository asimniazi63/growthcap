import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import type { UIMessageChunk } from "ai";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { proposeMemory } from "../memory/store";
import type { QueryMetricInput, MetricRow } from "../metrics/query";
import type { TenantContext } from "../tenancy/context";
import type { ToolResult } from "../tools/result";
import { buildView, type ViewSource } from "../views/build";
import { VIEW_COMPONENTS, type ViewPayload } from "../views/types";

// The two tools that act on the conversation rather than read the store: render_view draws a result, remember proposes a
// note. Both are built per turn, because they use this turn's tool results and its stream.

export interface TurnCall {
  tool: string;
  input: unknown;
  result: ToolResult<unknown>;
}

interface StepRecord {
  tool: string;
  input: unknown;
  ok: boolean;
  errorCode?: string;
  latencyMs: number;
}

export interface ViewToolDeps {
  calls: Map<string, TurnCall>; // this turn's tool results by query id: the only data a view can be drawn from
  write: (chunk: UIMessageChunk) => void;
  titleProblems: (title: string) => string[]; // numbers in a title that no result holds
  onStep: (e: StepRecord) => void;
}

export const renderViewInput = z.strictObject({
  component: z.enum(VIEW_COMPONENTS),
  title: z.string().trim().min(1).max(80),
  queryRefs: z.array(z.string().regex(/^q_[0-9a-f]{12}$/, "a query id looks like q_ followed by 12 hex characters")).min(1).max(3),
});

const recoverable = (e: unknown) => e instanceof AppError && (e.code === "INVALID_INPUT" || e.code === "NO_DATA");

export function buildRenderViewTool(d: ViewToolDeps) {
  return tool({
    description:
      "Draw results from this turn as a card or chart in the answer. component is one of kpi (totals), line (a metric by day, week or month), bar (a metric by product, channel, code and so on), table, gauge (month to date against plan; needs a result with gapToPlan) or waterfall (a bridge from the previous period, needs compareTo and a grouping). title is a few words. queryRefs are the queryId values of the query_metric results to draw. The server reads the numbers from those results; you never type them.",
    inputSchema: renderViewInput,
    execute: async (input) => {
      const started = Date.now();
      try {
        const sources: ViewSource[] = input.queryRefs.map((ref) => {
          const call = d.calls.get(ref);
          if (!call) throw new AppError("INVALID_INPUT", `${ref} is not a query id from this turn. Use the queryId of a result you already have.`);
          if (call.tool !== "query_metric") throw new AppError("INVALID_INPUT", "Views are drawn from query_metric results only.");
          return { tool: "query_metric", input: call.input as QueryMetricInput, result: call.result as ToolResult<MetricRow[]> };
        });
        const stray = d.titleProblems(input.title);
        if (stray.length > 0) throw new AppError("INVALID_INPUT", `The title has numbers that are not in the results (${stray.join(", ")}). Write the title without them.`);
        const data = buildView(input.component, sources);
        const payload: ViewPayload = { id: randomUUID(), component: input.component, title: input.title, data, sources: sources.map((s) => ({ tool: s.tool, input: s.input })) };
        d.write({ type: "data-view", data: payload } as UIMessageChunk);
        d.onStep({ tool: "render_view", input, ok: true, latencyMs: Date.now() - started });
        return { rendered: true, component: input.component, title: input.title };
      } catch (e) {
        d.onStep({ tool: "render_view", input, ok: false, errorCode: e instanceof AppError ? e.code : "INTERNAL_ERROR", latencyMs: Date.now() - started });
        if (recoverable(e)) return { error: { code: (e as AppError).code, message: (e as AppError).message } };
        throw e;
      }
    },
  });
}

export const rememberInput = z.strictObject({ text: z.string().min(1).max(600) });
const MAX_PROPOSALS_PER_TURN = 2;

export function buildRememberTool(d: { ctx: TenantContext; db: Db; write: (chunk: UIMessageChunk) => void; onStep: (e: StepRecord) => void }) {
  let proposed = 0;
  return tool({
    description:
      "Propose a note about the brand for the team to keep, when the user asks you to remember a fact or preference (for example 'exclude wholesale orders from average order value'). Write it as one plain sentence. It is saved as waiting for confirmation and used only after a Growth Capital admin or partner confirms it.",
    inputSchema: rememberInput,
    execute: async (input) => {
      const started = Date.now();
      try {
        if (proposed >= MAX_PROPOSALS_PER_TURN) throw new AppError("INVALID_INPUT", "At most two notes can be proposed in one answer.");
        const memory = await proposeMemory(d.db, d.ctx, input.text);
        proposed++;
        d.write({ type: "data-memory", data: { id: memory.id, text: memory.text, status: memory.status } } as UIMessageChunk);
        d.onStep({ tool: "remember", input, ok: true, latencyMs: Date.now() - started });
        return { saved: memory.status === "confirmed" ? "already confirmed" : "waiting for confirmation", text: memory.text };
      } catch (e) {
        d.onStep({ tool: "remember", input, ok: false, errorCode: e instanceof AppError ? e.code : "INTERNAL_ERROR", latencyMs: Date.now() - started });
        if (recoverable(e)) return { error: { code: (e as AppError).code, message: (e as AppError).message } };
        throw e;
      }
    },
  });
}
