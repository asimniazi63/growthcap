import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

// One in-memory Postgres (PGlite) per test file, created and migrated the first time it's asked for. Every later call in the
// same file empties the tables and hands the same database back. Booting a new one for every test used to take seconds each
// and was never freed, which grew a test run to gigabytes and got the editor killed by the out-of-memory killer.
let shared: Db | undefined;

async function empty(db: Db): Promise<void> {
  const result = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`)) as unknown as { rows: { tablename: string }[] };
  const names = result.rows.map((r) => `"${r.tablename}"`);
  if (names.length > 0) await db.execute(sql.raw(`truncate table ${names.join(", ")} restart identity cascade`));
}

// A database with the generated migrations applied and nothing in it, so tests need no database secrets.
// `fresh: true` gives a separate database that doesn't touch the shared one, for a test that needs two at once.
export async function createTestDb(options: { fresh?: boolean } = {}): Promise<Db> {
  if (options.fresh) {
    const db = drizzle(new PGlite(), { schema });
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
    return db;
  }
  if (shared) {
    await empty(shared);
    return shared;
  }
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  shared = db;
  return db;
}
