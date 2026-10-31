import { CheckCircle2, Newspaper, PencilLine, ShieldAlert, type LucideIcon } from "lucide-react";
import { SafeMarkdown } from "@/components/chat/safe-markdown";
import { EmptyState } from "@/components/ui/empty-state";
import type { BriefItem } from "@/lib/briefs/store";
import { formatRange } from "@/lib/pace/format";
import type { Role } from "@/lib/tenancy/context";
import { ApproveButton } from "./approve-button";

const BADGE: Record<BriefItem["status"], { text: string; style: string; icon: LucideIcon }> = {
  draft: { text: "Draft", style: "badge-warn", icon: PencilLine },
  blocked: { text: "Blocked", style: "badge-behind", icon: ShieldAlert },
  approved: { text: "Approved", style: "badge-ahead", icon: CheckCircle2 },
};

const day = (d: Date) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);

// This brand's Monday briefs. The body is rendered through the same allow-listed markdown as the chat (no raw HTML, no images, links only to this app and Shopify). Approve shows only on a draft, and only to a
// Growth Capital admin or partner.
export function BriefList({ briefs, role }: { briefs: BriefItem[]; role: Role }) {
  if (briefs.length === 0) {
    return (
      <EmptyState icon={Newspaper} title="No briefs yet">
        A brief for this brand is drafted every Monday. The first one will show up here.
      </EmptyState>
    );
  }
  const canApprove = role === "gc_admin" || role === "gc_partner";
  return (
    <ul className="space-y-5">
      {briefs.map((b) => {
        const badge = BADGE[b.status];
        const BadgeIcon = badge.icon;
        return (
          <li key={b.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
              <h2 className="section-title">Week of {formatRange(b.weekStart, b.weekStart)}</h2>
              <span className={`badge ${badge.style}`}>
                <BadgeIcon className="size-3.5" aria-hidden />
                {badge.text}
              </span>
            </div>
            <div className="px-5 py-5 sm:px-6 [&_p]:leading-7 [&_p]:text-[0.9375rem]">
              <div className="max-w-[68ch]">
                <SafeMarkdown text={b.body} />
              </div>
              {b.status === "blocked" ? (
                <div role="alert" className="mt-5 flex items-start gap-3 rounded-xl bg-behind-tint px-4 py-3.5 text-sm text-behind">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <div>
                    <p className="font-semibold">The number checker could not find these figures in the data, so this brief can&apos;t be approved:</p>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
                      {b.unmatched.map((u, i) => (
                        <li key={`${i}-${u}`}>{u}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              {b.status === "draft" && canApprove ? (
                <div className="mt-5">
                  <ApproveButton id={b.id} />
                </div>
              ) : null}
            </div>
            {b.status === "approved" ? (
              <p className="faint border-t border-line bg-paper px-5 py-3 text-sm sm:px-6">
                {b.approvedAt ? `Approved ${day(b.approvedAt)}. ` : ""}
                {b.delivered ? "Delivered." : "Not delivered."}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
