import { and, eq } from "drizzle-orm";
import { actions, calendarEvents, products } from "../lib/db/schema";
import { readFixtureFile } from "../scripts/fixtures/load-pace";
import { loadCalendar } from "../scripts/fixtures/load-why";
import type { EvalCase, EvalEnv } from "./cases";

// The landing-page case (T9): a Growth Capital user asks for a page for a planned campaign. The agent finds product handles
// with search_products and calls draft_landing_page, which proposes the page (nothing is published or written to Shopify).
// The case then reads the `actions` ledger row the tool left behind, because the saved files are the thing worth grading:
// prices read with `| money`, no typed currency, product handles that exist. Those checks are database checks, run by gradeAsync.
//
// It costs money (the chat model, a few tool calls). Run it with the T11 eval.

const CAMPAIGN = "Black Friday and Cyber Monday 2026";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// The calendar is loaded as `fixtures:load` does (idempotent). The fixture loader gives products handles such as "p_001", which
// no landing page accepts; the live store uses the title as the handle ("hero-vitamin-c-serum"), so the case sets the same.
// Earlier proposals are cleared so the checks see only this case's.
async function withCalendarAndHandles(env: EvalEnv): Promise<void> {
  const tenantId = env.ctx.tenantId;
  await loadCalendar(env.db, tenantId, readFixtureFile(env.store, "calendar.csv"));
  const rows = await env.db.select({ id: products.id, title: products.title }).from(products).where(eq(products.tenantId, tenantId));
  for (const r of rows) await env.db.update(products).set({ handle: slug(r.title) }).where(and(eq(products.tenantId, tenantId), eq(products.id, r.id)));
  await env.db.delete(actions).where(eq(actions.tenantId, tenantId));
}

interface SavedFile {
  path: string;
  content: string;
}
interface SavedPayload {
  files?: SavedFile[];
  handles?: string[];
  campaignId?: string;
}

const CURRENCY = /[$€£¥₹₽₩₺฿]|\b(?:USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF)\b|\b(?:dollars?|euros?|pounds?|bucks)\b/i;

// What the case checks in the ledger, read when a check runs, after the question.
function ledger(env: EvalEnv) {
  const rows = async () => {
    const found = await env.db.select().from(actions).where(and(eq(actions.tenantId, env.ctx.tenantId), eq(actions.kind, "landing_page")));
    return found.map((r) => ({ status: r.status, payload: (r.payload ?? {}) as SavedPayload }));
  };
  const proposed = async () => (await rows()).filter((r) => r.status === "proposed");
  const section = (p: SavedPayload) => (p.files ?? []).find((f) => f.path.startsWith("sections/"));
  return { rows, proposed, section };
}

export const LANDING_CASES: EvalCase[] = [
  {
    id: "landing-black-friday-2026",
    category: "landing",
    store: "solenne",
    now: "2026-11-02T12:00:00-05:00",
    question: "Draft a landing page for Black Friday and Cyber Monday 2026",
    setup: withCalendarAndHandles,
    expect: (env) => {
      const l = ledger(env);
      return {
        tools: ["search_products", "draft_landing_page"],
        toolWhere: [
          {
            label: "named the Black Friday and Cyber Monday 2026 campaign (by its title or its id)",
            tool: "draft_landing_page",
            test: (i) => {
              const ref = (i as { campaignId?: string }).campaignId ?? "";
              return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref) || ref.trim().toLowerCase() === CAMPAIGN.toLowerCase();
            },
          },
        ],
        mentions: [
          { label: "says the page is waiting for approval", pattern: /\b(?:waiting (?:for|on)|awaiting|pending|needs?|requires?|required|yet to be|not yet|hasn't been|has not been)\b[^\n]{0,60}\bapprov/i },
        ],
        avoid: [
          {
            label: "does not claim the page was published or is live",
            pattern: /\b(?:I|we)(?:'ve| have)?\s+(?:just |already |now )?(?:published|launched|deployed|pushed)\b|(?<!\bnothing\s)(?<!\bnone\s)(?<!\bnever\s)\b(?:is|was|has been|have been|are|now|already)\s+(?:now |already |been )*(?:published|live|launched|deployed|pushed live)\b/i,
          },
        ],
        database: [
          {
            label: "left a landing_page action in status proposed in the ledger",
            test: async () => {
              const all = await l.rows();
              const proposed = all.filter((r) => r.status === "proposed");
              if (proposed.length === 1) return null;
              return all.length === 0 ? "no landing_page action exists" : `${proposed.length} proposed of ${all.length} landing_page actions (statuses: ${all.map((r) => r.status).join(", ")})`;
            },
          },
          {
            label: "the proposed page belongs to the Black Friday and Cyber Monday 2026 campaign",
            test: async () => {
              const [event] = await env.db.select({ id: calendarEvents.id }).from(calendarEvents).where(and(eq(calendarEvents.tenantId, env.ctx.tenantId), eq(calendarEvents.title, CAMPAIGN)));
              const [row] = await l.proposed();
              if (!event) return `the calendar has no event titled "${CAMPAIGN}"`;
              if (!row) return "no proposed page";
              return row.payload.campaignId === event.id ? null : `the page's campaignId is ${row.payload.campaignId ?? "missing"}, the event is ${event.id}`;
            },
          },
          {
            label: "the saved section reads every price with | money",
            test: async () => {
              const [row] = await l.proposed();
              const section = row && l.section(row.payload);
              if (!section) return "no saved section file";
              const outputs = [...section.content.matchAll(/\{\{[^}]*price[^}]*\}\}/g)].map((m) => m[0]);
              if (outputs.length === 0) return "the section prints no price at all";
              const bare = outputs.filter((o) => !/\|\s*money\b/.test(o));
              return bare.length === 0 ? null : `prices printed without | money: ${bare.join(" ")}`;
            },
          },
          {
            label: "the saved files contain no currency symbol or code",
            test: async () => {
              const [row] = await l.proposed();
              if (!row) return "no proposed page";
              const bad = (row.payload.files ?? []).filter((f) => CURRENCY.test(f.content)).map((f) => `${f.path}: "${f.content.match(CURRENCY)![0]}"`);
              return bad.length === 0 ? null : bad.join("; ");
            },
          },
          {
            label: "every product shown has a handle that exists in the store",
            test: async () => {
              const [row] = await l.proposed();
              const section = row && l.section(row.payload);
              if (!section) return "no saved section file";
              const shown = [...section.content.matchAll(/all_products\[\s*(['"])(.*?)\1\s*\]/g)].map((m) => m[2]!);
              if (shown.length === 0) return "the section shows no product";
              const active = await env.db.select({ handle: products.handle }).from(products).where(and(eq(products.tenantId, env.ctx.tenantId), eq(products.status, "ACTIVE")));
              const known = new Set(active.map((p) => p.handle));
              const missing = shown.filter((h) => !known.has(h));
              return missing.length === 0 ? null : `no active product has the handle ${missing.join(", ")}`;
            },
          },
        ],
        verified: true,
      };
    },
  },
];
