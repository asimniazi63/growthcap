// `npm run landing:push -- <action id>`
// Finishes an approved landing page by hand when Shopify refuses the app's theme write (themeFilesUpsert needs an exemption).
// It reads the approved action from the ledger, checks its payload against the hash taken when it was proposed, pushes the two
// files to the unpublished theme with the Shopify CLI (as you, signed in to the CLI), then creates the hidden page through the
// app's own connection and records the result in the ledger. It never touches the live theme and publishes nothing.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { hashPayload } from "../lib/actions/ledger";
import { shopGraphqlFor } from "../lib/actions/shopify";
import { getDb } from "../lib/db/client";
import { actions, shopConnections } from "../lib/db/schema";
import { createPage } from "../lib/landing/executor";
import { SKELETON } from "../lib/landing/validate";
import { landingPayloadSchema } from "../lib/landing/types";
import type { TenantContext } from "../lib/tenancy/context";

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const id = process.argv[2];
  if (!id) throw new Error("Usage: npm run landing:push -- <action id>");
  const db = getDb();
  const [row] = await db.select().from(actions).where(eq(actions.id, id)).limit(1);
  if (!row || row.kind !== "landing_page") throw new Error("That is not a landing page action.");
  const result = row.result as { written?: boolean; themeId?: string; themeName?: string } | null;
  if (!row.decidedBy || row.status !== "failed" || result?.written !== false || !result.themeId) {
    throw new Error(`Only an approved landing page that Shopify refused to write can be finished here (this one is ${row.status}).`);
  }
  const parsed = landingPayloadSchema.safeParse(row.payload);
  if (!parsed.success || hashPayload(parsed.data) !== row.payloadHash) throw new Error("The payload changed after it was proposed; refusing to push it.");
  const payload = parsed.data;

  const [conn] = await db.select().from(shopConnections).where(and(eq(shopConnections.tenantId, row.tenantId), eq(shopConnections.status, "connected"))).limit(1);
  if (!conn) throw new Error("The store is not connected.");
  const themeId = result.themeId.split("/").pop()!;

  const dir = mkdtempSync(path.join(tmpdir(), "oasis-push-"));
  try {
    for (const f of [...SKELETON, ...payload.files]) {
      mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true });
      writeFileSync(path.join(dir, f.path), f.content, "utf8");
    }
    console.log(`Pushing ${payload.files.length} files to "${result.themeName ?? themeId}" (unpublished) on ${conn.shopDomain} ...`);
    const only = payload.files.flatMap((f) => ["--only", f.path]);
    execFileSync("shopify", ["theme", "push", "--path", dir, "--store", conn.shopDomain, "--theme", themeId, "--nodelete", "--no-color", ...only], { stdio: "inherit" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const ctx = { tenantId: row.tenantId } as TenantContext;
  const graphql = await shopGraphqlFor(db, ctx);
  // A page already at that address with this template (an earlier try made it) counts as created, so a re-run can finish the record.
  const page = await createPage(graphql, payload);
  await db
    .update(actions)
    .set({
      status: "done",
      error: null,
      result: { written: true, via: "shopify-cli", themeId: result.themeId, pageId: page.id, handle: page.handle, published: page.isPublished, ...(page.existed ? { pageExisted: true } : {}) },
      updatedAt: new Date(),
    })
    .where(eq(actions.id, id));
  console.log(`Done. ${page.isPublished ? "Page" : "Hidden page"} /pages/${page.handle} ${page.existed ? "was already in the store and" : "was created and"} uses the new template. Preview it in the theme editor, then publish it from the Shopify admin.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
