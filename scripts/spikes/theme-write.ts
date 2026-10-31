// `npx tsx scripts/spikes/theme-write.ts --store solenne|tidepool [--write]`
// Checks what the landing page writer needs, against the real store, using the stored connection (the same path the ledger
// uses on approval). Without --write it is read-only: it prints the scopes granted and the store's themes (id, role, name).
// With --write it also upserts one harmless snippet (snippets/oasis-spike.liquid, a Liquid comment) into the theme the
// executor would pick, and only when that theme's role is UNPUBLISHED. It creates no page and publishes nothing.
// Needs write_themes granted AND Shopify's exemption for themeFilesUpsert; if the API refuses, the fallback is
// `shopify theme push` with a Theme Access password (not built).
import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { shopGraphqlFor } from "../../lib/actions/shopify";
import { getDb } from "../../lib/db/client";
import { shopConnections } from "../../lib/db/schema";
import { THEMES_QUERY, THEME_FILES_UPSERT, pickTheme, type ThemeNode } from "../../lib/landing/executor";
import type { TenantContext } from "../../lib/tenancy/context";
import { STORES } from "../seed/stores.js";
import type { StoreKey } from "../seed/types.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : undefined;
};

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const store = arg("store") as StoreKey | undefined;
  if (store !== "solenne" && store !== "tidepool") throw new Error("Usage: npx tsx scripts/spikes/theme-write.ts --store solenne|tidepool [--write]");
  const shopDomain = process.env[STORES[store].shopDomainEnv];
  if (!shopDomain) throw new Error(`${STORES[store].shopDomainEnv} is not set`);

  const db = getDb();
  const [conn] = await db.select().from(shopConnections).where(and(eq(shopConnections.shopDomain, shopDomain), eq(shopConnections.status, "connected"))).limit(1);
  if (!conn) throw new Error(`${shopDomain} is not connected.`);
  const ctx: TenantContext = {
    tenantId: conn.tenantId,
    orgId: "spike",
    userId: "spike",
    role: "gc_admin",
    shop: { domain: conn.shopDomain, timezone: conn.timezone, currency: conn.currency, status: conn.status },
  };

  const granted = new Set(conn.scopes.split(",").map((s) => s.trim()).filter(Boolean));
  const has = (s: string) => (granted.has(s) ? "granted" : "NOT granted");
  console.log(`scopes: read_themes ${has("read_themes")}, write_themes ${has("write_themes")}, write_content ${has("write_content")}, write_online_store_pages ${has("write_online_store_pages")}`);

  const graphql = await shopGraphqlFor(db, ctx);
  const raw = (await graphql(`query OasisAllThemes { themes(first: 20) { nodes { id name role processing } } }`, {})) as { themes: { nodes: ThemeNode[] } };
  console.log(`themes (${raw.themes.nodes.length}):`);
  for (const t of raw.themes.nodes) console.log(`  ${t.id}  ${t.role.padEnd(11)}  ${t.name}${t.processing ? "  (processing)" : ""}`);

  const unpublished = (await graphql(THEMES_QUERY, {})) as { themes: { nodes: ThemeNode[] } };
  let target: ThemeNode;
  try {
    target = pickTheme(unpublished.themes.nodes);
  } catch (e) {
    console.log(`executor would stop: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  console.log(`the executor would write to: ${target.id}  ${target.name}`);

  if (!process.argv.includes("--write")) {
    console.log("read-only run. Add --write to upsert one harmless snippet into that theme.");
    return;
  }
  if (target.role !== "UNPUBLISHED") throw new Error("Refusing to write: that theme is not UNPUBLISHED.");
  const body = `{%- comment -%} Oasis write spike, ${new Date().toISOString()}. Safe to delete. {%- endcomment -%}\n`;
  const out = await graphql(THEME_FILES_UPSERT, { themeId: target.id, files: [{ filename: "snippets/oasis-spike.liquid", body: { type: "TEXT", value: body } }] });
  console.log("themeFilesUpsert answered:", JSON.stringify(out));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
