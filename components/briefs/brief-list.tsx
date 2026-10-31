import { SafeMarkdown } from "@/components/chat/safe-markdown";
import type { BriefItem } from "@/lib/briefs/store";
import { formatRange } from "@/lib/pace/format";
import type { Role } from "@/lib/tenancy/context";
import { ApproveButton } from "./approve-button";

const BADGE: Record<BriefItem["status"], { text: string; style: string }> = {
  draft: { text: "Draft", style: "bg-amber-100 text-amber-900" },
  blocked: { text: "Blocked", style: "bg-red-100 text-red-900" },
  approved: { text: "Approved", style: "bg-emerald-100 text-emerald-900" },
};

const day = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);

// This brand's Monday briefs. The body is rendered through the same allow-listed markdown as the chat (no raw HTML, no images, links only to this app and Shopify). Approve shows only on a draft, and only to a
// Growth Capital admin or partner.
export function BriefList({ briefs, role }: { briefs: BriefItem[]; role: Role }) {
  if (briefs.length === 0) {
    return <p className="rounded-lg border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">No briefs yet. They are drafted every Monday.</p>;
  }
  const canApprove = role === "gc_admin" || role === "gc_partner";
  return (
    <ul className="space-y-4">
      {briefs.map((b) => (
        <li key={b.id} className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">Week of {formatRange(b.weekStart, b.weekStart)}</h2>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[b.status].style}`}>{BADGE[b.status].text}</span>
          </div>
          <div className="mt-3">
            <SafeMarkdown text={b.body} />
          </div>
          {b.status === "blocked" ? (
            <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              <p className="font-medium">The number checker could not find these figures in the data, so this brief can&apos;t be approved:</p>
              <ul className="mt-1 list-disc pl-5">
                {b.unmatched.map((u, i) => (
                  <li key={`${i}-${u}`}>{u}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {b.status === "draft" && canApprove ? (
            <div className="mt-3">
              <ApproveButton id={b.id} />
            </div>
          ) : null}
          {b.status === "approved" ? (
            <p className="mt-3 text-xs text-neutral-500">
              {b.approvedAt ? `Approved ${day(b.approvedAt)}. ` : ""}
              {b.delivered ? "Delivered." : "Not delivered."}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
