import { after, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { canResync, startSync } from "@/lib/sync/run";
import { getTenantContext } from "@/lib/tenancy/context";

export const runtime = "nodejs";
export const maxDuration = 300;

// The Resync button. The tenant comes from the Clerk session. The sync itself runs after the response is sent,
// and /connect shows its progress from the sync_runs table.
export async function POST(request: Request) {
  const back = (query: string) => NextResponse.redirect(new URL(`/connect?${query}`, request.url), 303);

  let ctx;
  try {
    ctx = await getTenantContext();
  } catch {
    return back("error=no_tenant");
  }
  if (!canResync(ctx.role)) return back("error=sync_forbidden");

  const begun = await startSync(getDb(), ctx.tenantId, (work) => after(work));
  if (begun.ok) return back("sync=started");
  return back(begun.reason === "already_running" ? "error=sync_running" : "error=not_connected");
}
