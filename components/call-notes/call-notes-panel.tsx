import { CallNoteForm } from "@/components/call-notes/call-note-form";
import { CallNoteReviewCard } from "@/components/call-notes/call-note-review";
import { getDb } from "@/lib/db/client";
import { canManageNotes } from "@/lib/call-notes/access";
import { listWaitingCallNotes } from "@/lib/call-notes/store";
import type { TenantContext } from "@/lib/tenancy/context";

// The "add a call note" form with the notes waiting for review under it. Server component: it loads its own data for the
// signed-in brand. Renders nothing for a client viewer. Mount it on /plan: <CallNotesPanel ctx={ctx} />.
export async function CallNotesPanel({ ctx }: { ctx: TenantContext }) {
  if (!canManageNotes(ctx)) return null;
  const waiting = await listWaitingCallNotes(getDb(), ctx);
  const currency = ctx.shop?.currency ?? "USD";
  return (
    <section className="space-y-4" aria-label="Call notes">
      <CallNoteForm />
      {waiting.map((note) => (
        <CallNoteReviewCard key={note.id} note={note} currency={currency} />
      ))}
    </section>
  );
}
