import { Lock } from "lucide-react";
import { ErrorBanner } from "@/components/chat/error-banner";
import { PortfolioTable } from "@/components/portfolio/portfolio-table";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { getPortfolio, type PortfolioRow } from "@/lib/portfolio/portfolio";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

export default async function PortfolioPage() {
  const ctx = await loadTenant();
  const heading = <PageHeader title="Portfolio" description="Your brands, ranked by net sales behind plan this month, with the part of the gap that pulled the most." />;
  if (!ctx) {
    return (
      <section>
        {heading}
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }
  if (ctx.role === "client_viewer") {
    return (
      <section>
        {heading}
        <div role="alert" className="card flex items-start gap-3 px-4 py-3.5 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <p className="muted">Growth Capital roles only. The portfolio compares brands, so it is open to Growth Capital admins and partners.</p>
        </div>
      </section>
    );
  }

  let rows: PortfolioRow[] = [];
  let failed = false;
  try {
    rows = await getPortfolio(getDb(), ctx);
  } catch {
    failed = true;
  }
  return (
    <section>
      {heading}
      {failed ? <ErrorBanner code="INTERNAL_ERROR" role={ctx.role} /> : <PortfolioTable rows={rows} />}
    </section>
  );
}
