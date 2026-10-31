import { CheckCircle2, Newspaper, PencilLine, ShieldAlert, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import type { BriefItem } from "@/lib/briefs/store";
import { plainSnippet } from "@/lib/overview/format";
import { formatRange } from "@/lib/pace/format";

const BADGE: Record<BriefItem["status"], { text: string; style: string; Icon: LucideIcon }> = {
  draft: { text: "Draft", style: "badge-warn", Icon: PencilLine },
  blocked: { text: "Blocked", style: "badge-behind", Icon: ShieldAlert },
  approved: { text: "Approved", style: "badge-ahead", Icon: CheckCircle2 },
};

// The newest brief for this brand. The body was written from the store's data, so it is shown as plain text.
export function BriefCard({ brief, canApprove }: { brief: BriefItem | null; canApprove: boolean }) {
  const badge = brief ? BADGE[brief.status] : null;
  return (
    <section className="card card-pad" aria-labelledby="ov-brief">
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <h2 id="ov-brief" className="section-title">
          Latest brief
        </h2>
        {badge ? (
          <span className={`badge ${badge.style}`}>
            <badge.Icon className="size-3.5" aria-hidden />
            {badge.text}
          </span>
        ) : null}
      </div>
      {brief ? (
        <>
          <p className="muted text-sm">Week of {formatRange(brief.weekStart, brief.weekStart)}</p>
          <p className="my-2 mb-3 break-words border-l-[3px] border-brand-tint pl-3 text-sm leading-relaxed text-ink-2">{plainSnippet(brief.body, 220)}</p>
          <Link href="/briefs" className="btn btn-secondary btn-sm">
            {canApprove && brief.status === "draft" ? "Read and approve" : "Read the brief"}
          </Link>
        </>
      ) : (
        <EmptyState icon={Newspaper} title="No briefs yet">
          A brief for this brand is drafted every Monday.
        </EmptyState>
      )}
    </section>
  );
}
