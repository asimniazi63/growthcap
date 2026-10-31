import { tool } from "ai";
import type { UIMessageChunk } from "ai";
import { z } from "zod";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { isValidDate } from "../metrics/dates";
import { METRIC_IDS } from "../metrics/registry";
import type { TenantContext } from "../tenancy/context";
import type { ExtraToolDeps } from "../agent/extra-types";
import { annotationPayload } from "./executors/annotation";
import { discountDeactivatePayload } from "./executors/discount-deactivate";
import { metricTargetPayload } from "./executors/metric-target";
import type { ActionView, ProposeInput } from "./types";

// propose_action: the agent can ask for a change, never make one. This only writes a proposal to the ledger and puts an
// approval card in the chat; a Growth Capital admin or partner approves it, and the server runs it. The lead wires this tool
// for admin and partner only. No field here is a tenant, shop or user: those come from the session in `d.ctx`.

type Propose = (db: Db, ctx: TenantContext, input: ProposeInput) => Promise<ActionView>;

// Loaded on first use, so a test that injects its own `propose` never loads the ledger.
const ledgerPropose: Propose = async (db, ctx, input) => (await import("./ledger")).proposeAction(db, ctx, input);

const MAX_PROPOSALS_PER_TURN = 3;

const date = z.string().refine(isValidDate, "a date as YYYY-MM-DD");
const common = {
  title: z.string().trim().min(1).max(120),
  hypothesis: z.string().trim().min(1).max(240),
  checkOn: date,
};

// What a proposal must be, kind by kind: strict, so a key from another kind is refused. The payload fields come from the
// executors' own schemas, so the tool and the executor cannot disagree about them. Two names would clash in one flat
// object: for a metric target `metric` is both the payload's metric and the metric the action should move (the same
// thing), and an annotation's title is `annotationTitle` and its text `annotationText`.
export const proposeActionUnion = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("metric_target"), ...metricTargetPayload.shape, ...common }),
  z.strictObject({
    kind: z.literal("annotation"),
    date: annotationPayload.shape.date,
    annotationTitle: annotationPayload.shape.title,
    annotationText: annotationPayload.shape.text,
    metric: z.enum(METRIC_IDS),
    ...common,
  }),
  z.strictObject({ kind: z.literal("discount_deactivate"), ...discountDeactivatePayload.shape, metric: z.enum(METRIC_IDS), ...common }),
]);
export type ProposeActionInput = z.infer<typeof proposeActionUnion>;

// What the model is shown. Anthropic's tool schema must be one object at the top (a union there is refused), so the
// model sees a flat strict object with the fields of every kind optional, and execute() checks it against the union.
export const proposeActionInput = z.strictObject({
  kind: z.enum(["metric_target", "annotation", "discount_deactivate"]),
  title: z.string().max(120).describe("What the card says, a few words. For example: Set November net sales target"),
  hypothesis: z.string().max(240).describe("One sentence on why this should help"),
  metric: z.enum(METRIC_IDS).describe("The metric this change should move. For metric_target it is the target's own metric: net_sales or orders"),
  checkOn: z.string().describe("YYYY-MM-DD, when to look at whether it worked"),
  month: z.string().optional().describe("metric_target only: the month, YYYY-MM"),
  value: z.number().optional().describe("metric_target only: the target as a whole number, in cents for net_sales (1200000 is $12,000.00) and a count for orders"),
  date: z.string().optional().describe("annotation only: the day the note is about, YYYY-MM-DD"),
  annotationTitle: z.string().optional().describe("annotation only: the title on the chart, up to 75 characters"),
  annotationText: z.string().optional().describe("annotation only: the note, up to 150 characters, plain text"),
  code: z.string().optional().describe("discount_deactivate only: the discount code in capitals, such as VIPGLOW25"),
});

function toProposal(i: ProposeActionInput): ProposeInput {
  const { kind, title, hypothesis, checkOn } = i;
  const base = { kind, title, hypothesis, checkOn, metric: i.metric };
  switch (i.kind) {
    case "metric_target":
      return { ...base, payload: { metric: i.metric, month: i.month, value: i.value } };
    case "annotation":
      return { ...base, payload: { date: i.date, title: i.annotationTitle, text: i.annotationText } };
    case "discount_deactivate":
      return { ...base, payload: { code: i.code } };
  }
}

const problems = (e: z.ZodError) => e.issues.map((x) => `${x.path.join(".") || "input"}: ${x.message}`).join("; ");

export function buildProposeActionTool(d: ExtraToolDeps, propose: Propose = ledgerPropose) {
  let proposed = 0;
  return tool({
    description:
      "Propose a change to the store or its analytics, only when the user asks for one. kind is metric_target (a Shopify sales or orders target for a month), annotation (a dated note on the store's Shopify charts) or discount_deactivate (turn a discount code off). Fill in only the fields for that kind. This does not make the change: it puts an approval card in the answer, and the change happens only after a Growth Capital admin or partner approves it. After calling it, say the change is waiting for that approval and never that it was done. You cannot see or state the outcome.",
    inputSchema: proposeActionInput,
    execute: async (input) => {
      const started = Date.now();
      try {
        if (proposed >= MAX_PROPOSALS_PER_TURN) throw new AppError("INVALID_INPUT", "At most three changes can be proposed in one answer.");
        const parsed = proposeActionUnion.safeParse(input);
        if (!parsed.success) throw new AppError("INVALID_INPUT", `That proposal is not valid (${problems(parsed.error)}). Fix it and call propose_action again, or ask the user.`);
        const view = await propose(d.db, d.ctx, toProposal(parsed.data));
        proposed++;
        d.write({ type: "data-action", data: view } as UIMessageChunk);
        d.onStep({ tool: "propose_action", input, ok: true, latencyMs: Date.now() - started });
        // No amounts and no outcome: the card shows the figures, and nothing here for the model to misquote.
        return { proposed: true, actionId: view.id, needsApproval: true };
      } catch (e) {
        d.onStep({ tool: "propose_action", input, ok: false, errorCode: e instanceof AppError ? e.code : "INTERNAL_ERROR", latencyMs: Date.now() - started });
        if (e instanceof AppError && e.code === "INVALID_INPUT") return { error: { code: e.code, message: e.message } };
        throw e;
      }
    },
  });
}
