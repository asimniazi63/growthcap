// `npm run chat:try -- --store solenne|tidepool --q "How did net sales do last month?" [--model devstral-2]`
// Asks the real agent one question against the synced data in Neon, with the real model on Bedrock, and prints the
// answer, the tool steps, the number check and what the call cost. It makes PAID model calls (a few cents at most) and
// writes one `eval` run to agent_runs (which doesn't count against any brand's budget). Run it only on purpose.
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { UIMessageChunk } from "ai";
import { getDb } from "../lib/db/client";
import { shopConnections } from "../lib/db/schema";
import { runAgent } from "../lib/agent/run";
import type { TenantContext } from "../lib/tenancy/context";
import { STORES } from "./seed/stores.js";
import type { StoreKey } from "./seed/types.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const store = arg("store") as StoreKey | undefined;
  const question = arg("q");
  if ((store !== "solenne" && store !== "tidepool") || !question) throw new Error('Usage: npm run chat:try -- --store solenne|tidepool --q "your question" [--model <id>]');

  const shopDomain = process.env[STORES[store].shopDomainEnv];
  const db = getDb();
  const [conn] = await db.select().from(shopConnections).where(eq(shopConnections.shopDomain, shopDomain ?? "")).limit(1);
  if (!conn) throw new Error(`${STORES[store].shopDomainEnv} is not connected to any brand.`);
  const ctx: TenantContext = {
    tenantId: conn.tenantId,
    orgId: "operator",
    userId: "chat-try",
    role: "gc_admin",
    shop: { domain: conn.shopDomain, timezone: conn.timezone, currency: conn.currency, status: conn.status },
  };

  const { stream, finished } = runAgent(ctx, { messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: question }] }], modelId: arg("model") }, { db, source: "eval" });
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const summary = await finished;

  // The answer is the last text block: an earlier one is a first draft that the number check sent back for repair.
  const blocks: string[] = [];
  for (const c of chunks) {
    if (c.type === "text-start") blocks.push("");
    else if (c.type === "text-delta" && blocks.length > 0) blocks[blocks.length - 1] += c.delta;
  }
  const answer = blocks.at(-1) ?? "";
  if (blocks.length > 1) console.log(`(${blocks.length - 1} earlier draft${blocks.length > 2 ? "s" : ""} replaced after the number check)`);
  const error = chunks.find((c) => c.type === "error") as { errorText?: string } | undefined;
  const verification = chunks.filter((c) => c.type === "data-verification").map((c) => (c as unknown as { data: { ok: boolean; unmatched: { text: string }[] } }).data);

  console.log(`\nQ: ${question}\n`);
  console.log(error ? `ERROR: ${error.errorText}` : `A: ${answer}`);
  console.log(`\nNumber check: ${verification.map((v) => (v.ok ? "ok" : `unmatched ${v.unmatched.map((u) => u.text).join(", ")}`)).join(" -> ") || "(no numbers)"}`);
  console.log(`Model: ${summary.modelId}. Tokens in/out: ${summary.inputTokens}/${summary.outputTokens}. Estimated cost: $${(summary.costMicros / 1e6).toFixed(4)}. Tool steps: ${summary.steps}. Repaired: ${summary.repaired}.`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
