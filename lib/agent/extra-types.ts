import type { LanguageModel, UIMessageChunk } from "ai";
import type { Db } from "../db/client";
import type { TenantContext } from "../tenancy/context";
import type { TurnCall } from "./view-tools";

// What every per-turn tool builder in the stretch tickets receives, the same as render_view and remember do. Each builder is a
// function `(d: ExtraToolDeps) => Tool` in its own module; the lead wires them into lib/agent/run.ts, and the lead alone
// edits run.ts, tools.ts and prompt.ts.
export interface ExtraToolDeps {
  ctx: TenantContext;
  db: Db;
  model: LanguageModel; // the model running this turn, for a tool that calls a model itself (a sub-agent)
  now: Date;
  calls: Map<string, TurnCall>; // this turn's tool results by query id
  write: (chunk: UIMessageChunk) => void; // sends a part to the browser (for example `data-action`)
  onStep: (e: { tool: string; input: unknown; ok: boolean; errorCode?: string; latencyMs: number }) => void;
}
