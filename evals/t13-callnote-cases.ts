import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { confirmCallNote, submitCallNote } from "../lib/call-notes/store";
import { actionItems, planTargets, plans } from "../lib/db/schema";
import { readerDeps } from "../lib/plan-in/model";
import { parseCallNote } from "../scripts/fixtures/load-why";
import type { StoreKey } from "../scripts/seed/types.js";
import type { EvalCase, EvalEnv } from "./cases";
import type { Expectation } from "./graders";

// The call-note case (T13): a call note is read, its plan change and action items are confirmed, and the agent is asked what is
// open. The expected owners, dates and target are parsed from the fixture's own text here, never from lib/call-notes, so the
// reader is not graded against itself. It costs money (two reader calls and the chat model). Run it with the T11 eval, not before.

const SOLENNE: StoreKey = "solenne";
const FIXTURE = "2026-11-01-black-friday-plan.md";

// The note sits outside fixtures/solenne/call-notes so the fixture loader does not add it to the brand's existing notes: the
// case submits it through the reader itself.
const fixtureFile = () => ({ name: FIXTURE, text: readFileSync(new URL(`../fixtures/${SOLENNE}/call-note-inputs/${FIXTURE}`, import.meta.url), "utf8") });

// "- Priya to send the Black Friday email schedule to Mara by 2026-11-10." -> { owner: "Priya", due: "2026-11-10" }
function expectedItems(): { owner: string; due: string }[] {
  const section = fixtureFile().text.split(/^## Action items\s*$/m)[1] ?? "";
  return [...section.matchAll(/^- (\w+) to [^\n]*? by (\d{4}-\d{2}-\d{2})\./gm)].map((m) => ({ owner: m[1]!, due: m[2]! }));
}

// "The November 2026 net sales target is raised to $12,000" -> { month: "2026-11", cents: 1200000 }
function expectedTarget(): { month: string; cents: number } {
  const m = /The (\w+) (\d{4}) net sales target is raised to \$([\d,]+)/.exec(fixtureFile().text);
  if (!m) throw new Error("The fixture has no net sales target line.");
  const month = String(new Date(`${m[1]} 1, ${m[2]} UTC`).getUTCMonth() + 1).padStart(2, "0");
  return { month: `${m[2]}-${month}`, cents: Number(m[3]!.replace(/,/g, "")) * 100 };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// The date as an answer may write it: 2026-11-10, November 10 or Nov 10, 10 November.
function datePattern(iso: string): string {
  const [, m, d] = iso.split("-").map(Number) as [number, number, number];
  const name = MONTHS[m - 1]!;
  return `${iso}|${name}\\s+0?${d}\\b|${name.slice(0, 3)}\\.?\\s+0?${d}\\b|\\b0?${d}(st|nd|rd|th)?\\s+(of\\s+)?${name}`;
}

// The note is read and confirmed through the same code a person uses, with the real reader, before the question is asked.
const readAndConfirm = async (env: EvalEnv) => {
  const note = parseCallNote(fixtureFile());
  const review = await submitCallNote(env.db, env.ctx, { title: note.title, heldOn: note.heldOn, text: note.body }, readerDeps());
  await confirmCallNote(env.db, env.ctx, review.id, { planChanges: review.planChanges.map((c) => c.index), actionItems: review.actionItems.map((a) => a.index) });
};

export const T13_CALLNOTE_CASES: EvalCase[] = [
  {
    id: "t13-callnote-action-items",
    category: "documents",
    store: SOLENNE,
    now: "2026-11-05T12:00:00-05:00",
    question: "What action items are open from the latest call note? Say who owns each one and when it is due.",
    setup: readAndConfirm,
    expect: (env): Expectation => {
      const items = expectedItems();
      const target = expectedTarget();
      return {
        tools: ["get_action_items"],
        // Each owner is named near the date they are due, so a mix-up between the two items fails.
        mentions: items.map((i) => ({
          label: `says ${i.owner} owns the item due ${i.due}`,
          pattern: new RegExp(`${i.owner}[\\s\\S]{0,240}(${datePattern(i.due)})|(${datePattern(i.due)})[\\s\\S]{0,240}${i.owner}`, "i"),
        })),
        verified: true,
        database: [
          {
            label: "both action items are stored as open, with their owner and due date",
            test: async () => {
              const rows = await env.db.select().from(actionItems).where(and(eq(actionItems.tenantId, env.ctx.tenantId), eq(actionItems.status, "open")));
              const missing = items.filter((i) => !rows.some((r) => r.owner === i.owner && r.dueOn === i.due));
              return missing.length === 0 ? null : `missing: ${missing.map((m) => `${m.owner} by ${m.due}`).join(", ")}; stored: ${rows.map((r) => `${r.owner} by ${r.dueOn}`).join(", ") || "none"}`;
            },
          },
          {
            label: `the active plan holds ${target.month} net sales of ${target.cents} cents`,
            test: async () => {
              const [row] = await env.db
                .select({ value: planTargets.value })
                .from(planTargets)
                .innerJoin(plans, and(eq(plans.id, planTargets.planId), eq(plans.tenantId, planTargets.tenantId)))
                .where(and(eq(planTargets.tenantId, env.ctx.tenantId), eq(plans.active, true), eq(planTargets.month, target.month), eq(planTargets.metric, "net_sales")));
              return row?.value === target.cents ? null : `the active plan has ${row?.value ?? "no target"} for ${target.month}`;
            },
          },
        ],
      };
    },
  },
];
