import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dollarsToCents, readInvoicePages } from "./invoice";
import { figuresWrittenIn } from "./figures";
import { pdfPages } from "./store";
import { scriptedReader } from "./test-support";

const source = JSON.parse(readFileSync(new URL("../../fixtures/solenne/invoice.json", import.meta.url), "utf8")) as { lines: { page: number; sku: string; description: string; qty: number; unitCostCents: number }[] };
const dollars = (c: number) => (c / 100).toFixed(2);
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const row = (l: (typeof source.lines)[number]) => `${l.sku} ${l.description} ${l.qty} ${money(l.unitCostCents)} ${money(l.qty * l.unitCostCents)}`;

describe("invoice reader", () => {
  it("turns dollars into whole cents with integer maths", () => {
    expect(dollarsToCents("12.40")).toBe(1240);
    expect(dollarsToCents("8.6")).toBe(860);
    expect(dollarsToCents("12.405")).toBeNull();
    expect(dollarsToCents("$12.40")).toBeNull();
    expect(dollarsToCents("0")).toBeNull();
  });

  it("reads the fixture invoice: verified quotes, integer cents, and drops what the page does not say", async () => {
    const pages = await pdfPages(new Uint8Array(readFileSync(new URL("../../fixtures/solenne/invoice.pdf", import.meta.url))));
    expect(pages).toHaveLength(2);
    const claims = source.lines.map((l) => ({ sentence: `SKU ${l.sku}, unit price ${money(l.unitCostCents)}, USD`, page: l.page, quote: row(l) }));
    const made = { sentence: "SKU SOL-77Q, unit price $1.00, USD", page: 2, quote: "SOL-77Q Invented serum 10 $1.00 $10.00" };
    const pass1 = { claims: [...claims, made] };
    const pass2 = { lines: source.lines.map((l, i) => ({ claim: i + 1, sku: l.sku, unitPrice: dollars(l.unitCostCents), currency: "USD" })), unapplied: [] };
    const out = await readInvoicePages(pages, { model: scriptedReader(pass1, pass2) });
    expect(out.lines.map((l) => [l.sku, l.unitCostCents, l.page])).toEqual(source.lines.map((l) => [l.sku, l.unitCostCents, l.page]));
    expect(out.unverified.map((u) => u.sentence)).toEqual([made.sentence]);
  });

  it("refuses a price that is not written in the quote", async () => {
    const pages = ["SOL-01A Vitamin C serum 600 $12.40 $7,440.00 USD"];
    const pass1 = { claims: [{ sentence: "SOL-01A at $13.00", page: 1, quote: "SOL-01A Vitamin C serum 600 $12.40 $7,440.00" }] };
    const pass2 = { lines: [{ claim: 1, sku: "SOL-01A", unitPrice: "13.00", currency: "USD" }], unapplied: [] };
    const out = await readInvoicePages(pages, { model: scriptedReader(pass1, pass2) });
    expect(out.lines).toHaveLength(0);
    expect(out.unapplied[0]?.reason).toMatch(/not written in the quoted text/);
  });
});

describe("figuresWrittenIn", () => {
  it("reads money, rates and counts as the checker counts them", () => {
    expect(figuresWrittenIn("Net sales $26,767 in total, at least 45% in Q4")).toEqual(
      expect.arrayContaining([
        { value: 26767, unit: "money" },
        { value: 45, unit: "rate" },
      ]),
    );
  });
});
