import { json, readJson, withTenant } from "@/lib/api/respond";
import { assertCanManageNotes } from "@/lib/call-notes/access";
import { MAX_NOTE_CHARS } from "@/lib/call-notes/read";
import { listWaitingCallNotes, submitCallNote } from "@/lib/call-notes/store";
import { getDb } from "@/lib/db/client";
import { readerDeps } from "@/lib/plan-in/model";

export const runtime = "nodejs";
export const maxDuration = 120; // a note is read in two model calls

// A Growth Capital admin or partner pastes a call note. It is stored and read for plan changes and action items to review;
// nothing is applied until they confirm. The brand and the person come from the session only.
export const POST = (request: Request) =>
  withTenant(async (ctx) => {
    assertCanManageNotes(ctx); // before the body is read
    const body = await readJson(request, MAX_NOTE_CHARS * 4 + 2_000);
    return json({ review: await submitCallNote(getDb(), ctx, body, readerDeps()) }, 201);
  });

export const GET = () => withTenant(async (ctx) => json({ reviews: await listWaitingCallNotes(getDb(), ctx) }));
