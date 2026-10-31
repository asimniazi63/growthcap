import { ErrorBanner } from "@/components/chat/error-banner";
import { BriefList } from "@/components/briefs/brief-list";
import { PageHeader } from "@/components/ui/page-header";
import { listBriefs, type BriefItem } from "@/lib/briefs/store";
import { getDb } from "@/lib/db/client";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function BriefsPage() {
  const ctx = await loadTenant();
  const heading = (
    <PageHeader
      title="Briefs"
      description="A short brief for this brand is drafted every Monday at 06:00 UTC. A Growth Capital admin or partner approves it. Approved briefs are delivered to the log until Slack is added."
    />
  );
  if (!ctx) {
    return (
      <section>
        {heading}
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }

  let briefs: BriefItem[] = [];
  let failed = false;
  try {
    briefs = await listBriefs(getDb(), ctx);
  } catch {
    failed = true;
  }
  return (
    <section>
      {heading}
      {failed ? <ErrorBanner code="INTERNAL_ERROR" role={ctx.role} /> : <BriefList briefs={briefs} role={ctx.role} />}
    </section>
  );
}
