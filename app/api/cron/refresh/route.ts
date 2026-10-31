import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { refreshAll } from "@/lib/sync/cron";
import { cronAuthorized } from "@/lib/sync/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Public route in proxy.ts: Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`. Nothing else may.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response("CRON_SECRET is not configured", { status: 500 });
  if (!cronAuthorized(request, secret)) return new Response("Unauthorized", { status: 401 });
  const results = await refreshAll(getDb());
  return NextResponse.json({ results: results.map((r) => ({ shop: r.shopDomain, outcome: r.outcome })) });
}
