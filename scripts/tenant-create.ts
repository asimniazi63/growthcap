// The only way a tenants row is made: `npm run tenant:create -- --org <clerkOrgId> [--name <name>]`.
// getTenantContext() never creates one, so an organization has no access until this has been run for it.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { eq } from "drizzle-orm";
import type { Db } from "../lib/db/client";
import { tenants } from "../lib/db/schema";

const USAGE = "usage: npm run tenant:create -- --org <clerkOrgId> [--name <name>]";

export async function fetchOrgName(orgId: string, secretKey: string | undefined, fetchFn: typeof fetch = fetch): Promise<string> {
  if (!secretKey) throw new Error("CLERK_SECRET_KEY is not set, so the organization's name can't be looked up. Pass --name instead.");
  const res = await fetchFn(`https://api.clerk.com/v1/organizations/${orgId}`, { headers: { Authorization: `Bearer ${secretKey}` } });
  if (!res.ok) throw new Error(`Clerk answered HTTP ${res.status} for organization ${orgId}`);
  const body = (await res.json()) as { name?: string };
  if (!body.name) throw new Error(`Clerk returned no name for organization ${orgId}`);
  return body.name;
}

export interface CreateTenantInput {
  db: Db;
  orgId: string;
  name?: string;
  lookupName?: (orgId: string) => Promise<string>;
}

export interface CreateTenantResult {
  created: boolean;
  tenantId: string;
  name: string;
}

export async function createTenant({ db, orgId, name, lookupName }: CreateTenantInput): Promise<CreateTenantResult> {
  if (!/^org_[A-Za-z0-9]+$/.test(orgId)) throw new Error(`"${orgId}" is not a Clerk organization id (they look like org_...)`);

  const [existing] = await db.select().from(tenants).where(eq(tenants.orgId, orgId)).limit(1);
  if (existing) return { created: false, tenantId: existing.id, name: existing.name };

  if (!name && !lookupName) throw new Error("No name given and no way to look one up");
  const finalName = name ?? (await lookupName!(orgId));
  const [row] = await db.insert(tenants).values({ orgId, name: finalName }).returning();
  return { created: true, tenantId: row!.id, name: row!.name };
}

export interface CliDeps {
  db: Db;
  lookupName: (orgId: string) => Promise<string>;
  log?: (line: string) => void;
}

// Returns the exit code: 0 done (or already there), 1 a problem, 2 bad usage.
export async function runCli(argv: string[], { db, lookupName, log = console.log }: CliDeps): Promise<number> {
  let org: string | undefined;
  let name: string | undefined;
  try {
    ({ org, name } = parseArgs({ args: argv, options: { org: { type: "string" }, name: { type: "string" } } }).values);
  } catch (e) {
    log(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  if (!org) {
    log(USAGE);
    return 2;
  }
  try {
    const result = await createTenant({ db, orgId: org, name, lookupName });
    log(result.created ? `Created tenant ${result.name} for ${org} (${result.tenantId})` : `Tenant for ${org} already exists: ${result.name} (${result.tenantId})`);
    return 0;
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

async function main(): Promise<void> {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const { getDb } = await import("../lib/db/client");
  const code = await runCli(process.argv.slice(2), {
    db: getDb(),
    lookupName: (orgId) => fetchOrgName(orgId, process.env.CLERK_SECRET_KEY),
  });
  process.exit(code); // the connection pool would otherwise keep the process alive
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
