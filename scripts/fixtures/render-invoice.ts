import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Renders fixtures/solenne/invoice.json to fixtures/solenne/invoice.pdf (two pages) with headless Chrome, the same way as
// sow.pdf. The JSON is the source of truth: the invoice eval reads its expected SKUs and costs from it.
// Run: npx tsx scripts/fixtures/render-invoice.ts   (set CHROME to the browser binary if it is not google-chrome)

interface Line {
  page: number;
  sku: string;
  description: string;
  qty: number;
  unitCostCents: number;
}
interface Invoice {
  notice: string;
  supplier: { name: string; address: string; contact: string };
  billTo: string;
  invoiceNumber: string;
  invoiceDate: string;
  purchaseOrder: string;
  currency: string;
  terms: string;
  lines: Line[];
  shippingCents: number;
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function invoiceHtml(inv: Invoice): string {
  const head = (page: number) => `<header><p class="notice">${esc(inv.notice)}</p><h1>Invoice ${esc(inv.invoiceNumber)}</h1><p class="sub">${esc(inv.supplier.name)}, page ${page} of 2</p></header>`;
  const rows = (page: number) =>
    inv.lines
      .filter((l) => l.page === page)
      .map((l) => `<tr><td>${esc(l.sku)}</td><td>${esc(l.description)}</td><td class="n">${l.qty}</td><td class="n">${money(l.unitCostCents)}</td><td class="n">${money(l.qty * l.unitCostCents)}</td></tr>`)
      .join("\n");
  const table = (page: number) => `<table><thead><tr><th>SKU</th><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead><tbody>\n${rows(page)}\n</tbody></table>`;
  const subtotal = inv.lines.reduce((n, l) => n + l.qty * l.unitCostCents, 0);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Supplier invoice</title><style>
@page { size: letter; margin: 0.8in; }
body { font: 11pt/1.45 Helvetica, Arial, sans-serif; color: #1c1c1c; }
.notice { font-size: 9pt; letter-spacing: 0.06em; color: #8a5a00; margin: 0 0 14pt; }
h1 { font-size: 20pt; margin: 0; } .sub { color: #555; margin: 2pt 0 18pt; }
dl { display: grid; grid-template-columns: 9rem 1fr; gap: 3pt 12pt; margin: 0 0 18pt; } dt { color: #555; } dd { margin: 0; }
table { width: 100%; border-collapse: collapse; margin-top: 8pt; } th, td { text-align: left; padding: 7pt 6pt; border-bottom: 1px solid #ccc; vertical-align: top; } th { font-size: 9.5pt; color: #555; }
.n { text-align: right; white-space: nowrap; } .page { break-after: page; } .totals { margin: 18pt 0 0 auto; width: 55%; } .totals td { border: 0; padding: 3pt 6pt; } .grand td { border-top: 2px solid #1c1c1c; font-weight: 700; }
</style></head><body>
<section class="page">${head(1)}
<dl><dt>Supplier</dt><dd>${esc(inv.supplier.name)}, ${esc(inv.supplier.address)}</dd><dt>Bill to</dt><dd>${esc(inv.billTo)}</dd><dt>Invoice date</dt><dd>${inv.invoiceDate}</dd><dt>Purchase order</dt><dd>${esc(inv.purchaseOrder)}</dd><dt>Currency</dt><dd>${inv.currency}</dd></dl>
<h2>Items, continued on page 2</h2>${table(1)}</section>
<section>${head(2)}<h2>Items</h2>${table(2)}
<table class="totals"><tr><td>Subtotal</td><td class="n">${money(subtotal)}</td></tr><tr><td>Shipping</td><td class="n">${money(inv.shippingCents)}</td></tr><tr class="grand"><td>Total due (${inv.currency})</td><td class="n">${money(subtotal + inv.shippingCents)}</td></tr></table>
<h2>Terms</h2><p>${esc(inv.terms)}</p><p>Questions: ${esc(inv.supplier.contact)}</p></section>
</body></html>`;
}

function main() {
  const root = fileURLToPath(new URL("../../fixtures/solenne/", import.meta.url));
  const inv = JSON.parse(readFileSync(join(root, "invoice.json"), "utf8")) as Invoice;
  const dir = mkdtempSync(join(tmpdir(), "invoice-"));
  const html = join(dir, "invoice.html");
  writeFileSync(html, invoiceHtml(inv));
  execFileSync(process.env.CHROME ?? "google-chrome", ["--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${join(root, "invoice.pdf")}`, `file://${html}`], { stdio: "ignore" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
