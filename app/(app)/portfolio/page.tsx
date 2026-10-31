import { ErrorBanner } from "@/components/chat/error-banner";
import { PortfolioTable } from "@/components/portfolio/portfolio-table";
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
  const heading = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
      <p className="mt-1 text-sm text-neutral-600">Your brands, ranked by net sales behind plan this month, with the part of the gap that pulled the most.</p>
    </div>
  );
  if (!ctx) {
    return (
      <section className="space-y-4">
        {heading}
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }
  if (ctx.role === "client_viewer") {
    return (
      <section className="space-y-4">
        {heading}
        <p role="alert" className="rounded-md border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">
          Growth Capital roles only. The portfolio compares brands, so it is open to Growth Capital admins and partners.
        </p>
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
    <section className="space-y-5">
      {heading}
      {failed ? <ErrorBanner code="INTERNAL_ERROR" role={ctx.role} /> : <PortfolioTable rows={rows} />}
    </section>
  );
}
