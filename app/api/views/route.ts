import { json, readJson, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { pinView } from "@/lib/views/saved";

export const runtime = "nodejs";
export const maxDuration = 60;

// Pins a view: the body names the component and the queries behind it. The server runs them once for the signed-in brand
// before saving, so a view that can't be drawn is refused here.
export const POST = (request: Request) => withTenant(async (ctx) => json(await pinView(ctx, (await readJson(request)) as never, { db: getDb() }), 201));
