import { json, withTenant } from "@/lib/api/respond";
import { listActions } from "@/lib/actions/ledger";
import { getDb } from "@/lib/db/client";

export const runtime = "nodejs";

// The brand's action ledger, newest first. `?status=proposed` narrows it. Any role in the brand can read it; deciding is POST on one action.
export const GET = (request: Request) =>
  withTenant(async (ctx) => {
    const status = new URL(request.url).searchParams.get("status") ?? undefined;
    return json({ actions: await listActions(getDb(), ctx, { status }) });
  });
