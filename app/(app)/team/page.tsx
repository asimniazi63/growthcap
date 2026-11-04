import { Lock } from "lucide-react";
import { ErrorBanner } from "@/components/chat/error-banner";
import { TeamView } from "@/components/team/team-view";
import { PageHeader } from "@/components/ui/page-header";
import { canViewTeam, getTeam, type Team } from "@/lib/team/team";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

export const metadata = { title: "Team" };

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

// For a Growth Capital admin only; the sidebar link is hidden from everyone else, and the page refuses anyone who types the address.
// It shows who belongs to the signed-in brand and the role each holds. Roles are changed in Clerk, not here.
export default async function TeamPage() {
  const ctx = await loadTenant();
  const heading = <PageHeader title="Team" description="Everyone who can sign in to this brand, and the role each person holds. Roles are set in Clerk; this page only shows them." />;
  if (!ctx) {
    return (
      <section>
        {heading}
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }
  if (!canViewTeam(ctx)) {
    return (
      <section>
        {heading}
        <div role="alert" className="card flex items-start gap-3 px-4 py-3.5 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <p className="muted">Growth Capital admins only. The team list shows who has access to the brand, so ask a Growth Capital admin if you need it.</p>
        </div>
      </section>
    );
  }

  let team: Team | null = null;
  try {
    team = await getTeam(ctx);
  } catch {
    team = null;
  }
  return (
    <section>
      {heading}
      {team ? <TeamView team={team} me={ctx.userId} /> : <ErrorBanner code="INTERNAL_ERROR" role={ctx.role} />}
    </section>
  );
}
