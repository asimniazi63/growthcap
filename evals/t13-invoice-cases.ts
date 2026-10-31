import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { actions, documents, variants } from "../lib/db/schema";
import { invoiceProposalSchema } from "../lib/plan-in/invoice";
import { matchInvoiceLines } from "../lib/plan-in/invoice-match";
import { readerDeps } from "../lib/plan-in/model";
import { readDocument, uploadDocument } from "../lib/plan-in/store";
import { readFixtureFile } from "../scripts/fixtures/load-pace";
import type { EvalCase, EvalEnv } from "./cases";

// The T13 document cases: a supplier invoice read into unit costs, and a question answered from an uploaded document with its
// page. Graded like the other cases, by deterministic checks. The expected SKUs and costs come from fixtures/solenne/invoice.json,
// the data the invoice PDF was rendered from (never from the reader), and the SOW's target from sow.md.
//
// They cost money: the invoice case runs the real reader (two model calls) in its setup, then the chat model. The SOW case
// makes no reader call (the document is stored as already read), only the chat model. Run them with the T11 eval, not before.
// `verified: true` needs the number checker to accept figures that the ask_document result's page text states (see
// documentFigureEntries in lib/plan-in/figures.ts).

interface InvoiceSource {
  currency: string;
  lines: { page: number; sku: string; description: string; qty: number; unitCostCents: number }[];
}
const invoiceSource = (): InvoiceSource => JSON.parse(readFileSync(new URL("../fixtures/solenne/invoice.json", import.meta.url), "utf8")) as InvoiceSource;
const NOT_IN_STORE = "SOL-99Z";
const fixturePdf = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/solenne/${name}`, import.meta.url)));

async function withInvoiceRead(env: EvalEnv): Promise<void> {
  await env.db.delete(actions).where(eq(actions.tenantId, env.ctx.tenantId));
  await env.db.delete(documents).where(eq(documents.tenantId, env.ctx.tenantId));
  const doc = await uploadDocument(env.db, env.ctx, { kind: "invoice", label: "invoice.pdf", bytes: fixturePdf("invoice.pdf") });
  await readDocument(env.db, env.ctx, doc.id, readerDeps()); // the real reader: two paid model calls
}

// The SOW is stored as read without calling the reader: the question only needs its pages.
async function withSowStored(env: EvalEnv): Promise<void> {
  await env.db.delete(documents).where(eq(documents.tenantId, env.ctx.tenantId));
  const doc = await uploadDocument(env.db, env.ctx, { kind: "sow", label: "sow.pdf", bytes: fixturePdf("sow.pdf") });
  await env.db.update(documents).set({ status: "read" }).where(and(eq(documents.id, doc.id), eq(documents.tenantId, env.ctx.tenantId)));
}

const sowReturningRate = () => {
  const row = readFixtureFile("solenne", "sow.md").split("\n").find((l) => /Returning-customer rate\s*\|\s*At least/i.test(l));
  return Number(/(\d+)%/.exec(row ?? "")![1]);
};

export const T13_INVOICE_CASES: EvalCase[] = [
  {
    id: "invoice-unit-costs",
    category: "documents",
    store: "solenne",
    now: "2026-11-01T12:00:00-05:00",
    question: "I uploaded the Harbourlight supplier invoice. Which of our products does it change the unit cost of, and what are the new unit costs?",
    setup: withInvoiceRead,
    expect: (env) => {
      const src = invoiceSource();
      const expected = src.lines.filter((l) => l.sku !== NOT_IN_STORE);
      return {
        tools: ["ask_document"],
        numbers: expected.map((l) => ({ label: `the new unit cost of ${l.sku}`, value: l.unitCostCents / 100, tolerance: 0.005 })),
        mentions: [
          ...expected.map((l) => ({ label: `names ${l.sku}`, pattern: new RegExp(l.sku.replace("-", "[-\\s]?"), "i") })),
          { label: "cites the invoice pages", pattern: /page\s*[12]\b/i },
        ],
        avoid: [{ label: "claims a cost was already changed in Shopify", pattern: /\b(has|have) been (updated|changed|applied)\b|\bI (updated|changed)\b/i }],
        verified: true,
        // What the reader stored, and that nothing was written: five costs read with their quotes, the SKU that is not in the store
        // is not matched to a variant, and no action or cost changed.
        database: [
          {
            label: "the reader found the five SKUs with the right costs in cents, each with a quote",
            test: async () => {
              const [row] = await env.db.select({ proposal: documents.proposal }).from(documents).where(eq(documents.tenantId, env.ctx.tenantId)).limit(1);
              const parsed = invoiceProposalSchema.safeParse(row?.proposal);
              if (!parsed.success) return "the invoice was not read into a proposal";
              for (const l of expected) {
                const found = parsed.data.lines.find((x) => x.sku.toUpperCase() === l.sku);
                if (!found) return `${l.sku} was not read`;
                if (found.unitCostCents !== l.unitCostCents) return `${l.sku} was read as ${found.unitCostCents} cents, the invoice says ${l.unitCostCents}`;
                if (found.currency !== src.currency || found.page !== l.page || found.quote.length < 8) return `${l.sku} has the wrong page, currency or quote`;
              }
              const unknown = await matchInvoiceLines(env.db, env.ctx.tenantId, src.currency, parsed.data.lines.filter((x) => x.sku.toUpperCase() === NOT_IN_STORE));
              return unknown.every((r) => r.status === "not_in_store") ? null : `${NOT_IN_STORE} was matched to a variant`;
            },
          },
          {
            label: "nothing was written: no action proposed and no unit cost changed",
            test: async () => {
              const proposed = await env.db.select({ id: actions.id }).from(actions).where(eq(actions.tenantId, env.ctx.tenantId));
              if (proposed.length > 0) return "an action was proposed without anyone confirming the document";
              const rows = await env.db.select({ sku: variants.sku, cost: variants.unitCostCents }).from(variants).where(eq(variants.tenantId, env.ctx.tenantId));
              const dataset = new Map(env.dataset.variants.map((v) => [v.sku, v.unitCost]));
              const changed = rows.find((r) => dataset.has(r.sku) && r.cost !== dataset.get(r.sku));
              return changed ? `${changed.sku}'s cost changed to ${changed.cost}` : null;
            },
          },
        ],
      };
    },
  },
  {
    id: "document-question-sow-page",
    category: "documents",
    store: "solenne",
    now: "2026-11-01T12:00:00-05:00",
    question: "According to the SOW, what returning-customer rate are we aiming for in Q4 2026? Which page says so?",
    setup: withSowStored,
    expect: () => ({
      tools: ["ask_document"],
      numbers: [{ label: "the returning-customer rate in the SOW", value: sowReturningRate(), tolerance: 0 }],
      mentions: [
        { label: "cites page 1, where the targets table is", pattern: /page\s*1\b/i },
        { label: "says the document states it", pattern: /SOW|statement of work|document/i },
      ],
      notTools: ["query_metric"], // a figure in a document is not a store metric
      verified: true,
    }),
  },
];
