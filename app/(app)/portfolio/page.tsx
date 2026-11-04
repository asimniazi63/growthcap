import { Lock } from "lucide-react";
import { ErrorBanner } from "@/components/chat/error-banner";
import { PortfolioTable } from "@/components/portfolio/portfolio-table";
import { MonthPicker } from "@/components/ui/month-picker";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { monthName } from "@/lib/pace/format";
import { listPaceMonths, monthParam, type PaceMonth } from "@/lib/pace/view";
import { getPortfolio, type PortfolioRow } from "@/lib/portfolio/portfolio";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

// The months the picker offers are the signed-in brand's, as on Pace. A brand with no connected store, or a list that can't be
// read, gets none, and so no picker.
async function loadMonths(ctx: TenantContext): Promise<PaceMonth[]> {
  try {
    return await listPaceMonths(ctx, { db: getDb() });
  } catch {
    return [];
  }
}

// `month` is the past month ranked; without one the page ranks this month.
const description = (month?: string) => `Your brands, ranked by net sales behind plan ${month ? `in ${monthName(month)}` : "this month"}, with the part of the gap that pulled the most.`;

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const asked = monthParam((await searchParams).month);
  const ctx = await loadTenant();
  const heading = <PageHeader title="Portfolio" description={description()} />;
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

  // The month shown is the one asked for when the picker offers it, otherwise this month. Only a past month is passed on: without
  // one, each brand is ranked by its own this month, as before.
  const months = await loadMonths(ctx);
  const shown = months.find((m) => m.month === asked) ?? months.find((m) => !m.closed);
  const month = shown?.closed ? shown.month : undefined;

  let rows: PortfolioRow[] = [];
  let failed = false;
  try {
    rows = await getPortfolio(getDb(), ctx, {}, { month });
  } catch {
    failed = true;
  }
  return (
    <section>
      <PageHeader title="Portfolio" description={description(month)} actions={shown ? <MonthPicker months={months} selected={shown.month} /> : undefined} />
      {failed ? <ErrorBanner code="INTERNAL_ERROR" role={ctx.role} /> : <PortfolioTable rows={rows} month={month} />}
    </section>
  );
}
