import { generateAllBriefs } from "@/lib/briefs/run";
import { getDb } from "@/lib/db/client";
import { cronAuthorized } from "@/lib/sync/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Public route in proxy.ts: Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`. Nothing else may.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET is not configured", { status: 500 });
  if (!cronAuthorized(request, secret)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await generateAllBriefs(getDb()));
}
