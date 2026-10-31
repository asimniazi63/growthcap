import { json, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { removeView } from "@/lib/views/saved";

export const runtime = "nodejs";

export const DELETE = (_request: Request, { params }: { params: Promise<{ id: string }> }) =>
  withTenant(async (ctx) => ((await removeView(ctx, (await params).id, { db: getDb() })) ? new Response(null, { status: 204 }) : json({ error: "NOT_FOUND" }, 404)));
