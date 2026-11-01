import { z } from "zod";
import { json, readJson, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { PLAYBOOK_IDS, parseParams } from "@/lib/playbooks/definitions";
import { runPlaybook } from "@/lib/playbooks/generate";
import { canRunPlaybooks, ranRecently } from "@/lib/playbooks/store";

export const runtime = "nodejs";
export const maxDuration = 120; // the fixed tool calls, then one agent run and at most one repair turn

// Playbook runs in progress in this instance, keyed brand:playbook, so a double click can't start a second run before the first
// is saved. The 10-minute check against the runs table covers the rest.
const running = new Set<string>();

// The request names only which playbook and, for the monthly review, which month. Both are checked against fixed lists before
// anything reaches the question; no free text gets through.
const request = z.strictObject({ playbook: z.enum(PLAYBOOK_IDS), month: z.string().optional() });

// A Growth Capital admin or partner runs a saved playbook for the signed-in brand. The brand, the person and the role come from
// the Clerk session, never from the body. A paid call, so at most one run of each playbook per brand per 10 minutes.
export const POST = (req: Request) =>
  withTenant(async (ctx) => {
    if (!canRunPlaybooks(ctx)) return json({ error: "FORBIDDEN" }, 403);
    const parsed = request.safeParse(await readJson(req, 1_000));
    if (!parsed.success) throw new AppError("INVALID_INPUT", `playbook must be one of ${PLAYBOOK_IDS.join(", ")}, and month (if given) like 2026-10.`);
    const { playbook, month } = parsed.data;
    const params = parseParams(playbook, month === undefined ? {} : { month });
    if (!ctx.shop || ctx.shop.status !== "connected") throw new AppError("STORE_DISCONNECTED", "The store is not connected, so the playbook can't run. Reconnect it and try again.");
    const db = getDb();
    const key = `${ctx.tenantId}:${playbook}`;
    if (running.has(key) || (await ranRecently(db, ctx.tenantId, playbook))) return json({ error: "TOO_MANY_REQUESTS", message: "This playbook ran for this brand a few minutes ago. Try again in 10 minutes." }, 429);
    running.add(key);
    try {
      const result = await runPlaybook(db, { id: ctx.tenantId, orgId: ctx.orgId, shop: ctx.shop }, { userId: ctx.userId, role: ctx.role }, playbook, params);
      return json({ status: result.outcome, id: result.runId });
    } finally {
      running.delete(key);
    }
  });
