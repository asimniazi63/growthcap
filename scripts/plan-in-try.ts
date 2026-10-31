// `npx tsx scripts/plan-in-try.ts [--model <id>]`
// Reads fixtures/solenne/sow.pdf with the real reader and the real model on Bedrock, and prints the targets next to the
// expected ones. It makes TWO PAID model calls (a few cents at most). Run it only on purpose. It needs no database.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readerDeps } from "../lib/plan-in/model";
import { readPages } from "../lib/plan-in/read";
import { pdfPages } from "../lib/plan-in/store";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

// Net sales for October, November and December ($6,507 / $10,433 / $9,827), and a returning-customer rate of at least 45% in
// each Q4 month. Money is in cents, a rate is a fraction.
const EXPECTED = [
  ...[
    ["2026-10", 650700],
    ["2026-11", 1043300],
    ["2026-12", 982700],
  ].map(([month, value]) => ({ month: month as string, metric: "net_sales", value: value as number })),
  ...["2026-10", "2026-11", "2026-12"].map((month) => ({ month, metric: "returning_customer_rate", value: 0.45 })),
];
// Stated in the SOW but not something a monthly plan can hold, so they must come back as "not applied" with a reason.
// (Refund rate is not one of the plan's metrics: net_sales, orders, new_customer_orders, aov, returning_customer_rate.)
const EXPECTED_UNAPPLIED = [/black friday/i, /refund rate/i];

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const pages = await pdfPages(new Uint8Array(readFileSync(fileURLToPath(new URL("../fixtures/solenne/sow.pdf", import.meta.url)))));
  const deps = readerDeps(process.env, arg("model"));
  console.log(`Read ${pages.length} pages from fixtures/solenne/sow.pdf. Calling the model twice...\n`);
  const out = await readPages(pages, deps);

  console.log("Targets read:");
  for (const t of out.targets) console.log(`  ${t.month}  ${t.metric.padEnd(24)} ${String(t.value).padStart(9)}  page ${t.page}  ${t.sentence}`);
  console.log("\nExpected targets:");
  for (const e of EXPECTED) {
    const hit = out.targets.find((t) => t.month === e.month && t.metric === e.metric && t.value === e.value);
    console.log(`  ${hit ? "ok     " : "MISSING"} ${e.month}  ${e.metric.padEnd(24)} ${String(e.value).padStart(9)}${hit ? `  page ${hit.page}` : ""}`);
  }
  const extra = out.targets.filter((t) => !EXPECTED.some((e) => e.month === t.month && e.metric === t.metric && e.value === t.value));
  console.log(extra.length === 0 ? "\nNo extra targets." : `\nEXTRA targets not in the expected list: ${extra.map((t) => `${t.month} ${t.metric}=${t.value}`).join(", ")}`);

  console.log("\nNot applied:");
  for (const u of out.unapplied) console.log(`  (page ${u.page}) ${u.sentence}\n      ${u.reason}`);
  for (const re of EXPECTED_UNAPPLIED) console.log(`  ${out.unapplied.some((u) => re.test(u.sentence)) ? "ok     " : "MISSING"} expected as not applied: ${re}`);
  if (out.unverified.length > 0) console.log(`\nIgnored (quote not found on the page): ${out.unverified.map((u) => u.sentence).join(" | ")}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
