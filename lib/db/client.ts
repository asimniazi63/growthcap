import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import ws from "ws";
import * as schema from "./schema";

// Both the Neon (production) and PGlite (tests) drivers produce a database of this shape, so repositories take a Db.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let cached: Db | undefined;

// Production uses the Neon serverless driver over WebSockets, because the HTTP driver has no interactive transactions.
export function getDb(): Db {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  neonConfig.webSocketConstructor = ws;
  cached = drizzle(new Pool({ connectionString: url }), { schema });
  return cached;
}
