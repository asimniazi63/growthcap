import { json, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { listThreads } from "@/lib/threads/store";

export const runtime = "nodejs";

export const GET = () => withTenant(async (ctx) => json({ threads: await listThreads(getDb(), ctx.tenantId, ctx.userId) }));
