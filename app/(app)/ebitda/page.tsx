import { ErrorBanner } from "@/components/chat/error-banner";
import { BridgeTable } from "@/components/ebitda/bridge-table";
import { CostSheet } from "@/components/ebitda/cost-sheet";
import { Receipts } from "@/components/ebitda/receipts";
import { ScenarioPanel } from "@/components/ebitda/scenario-panel";
import { Waterfall } from "@/components/ebitda/waterfall";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getDb } from "@/lib/db/client";
import { canEditCostSheet } from "@/lib/ebitda/access";
import { scenarioBaseOf } from "@/lib/ebitda/actuals";
import { loadAssumptions, loadCostSheet } from "@/lib/ebitda/store";
import type { CostAssumptions, CostSheetRow, EbitdaData, EbitdaMonth } from "@/lib/ebitda/types";
import { AppError, type ErrorCode } from "@/lib/errors";
import { monthName } from "@/lib/pace/format";
import { getTenantContext, type TenantContext } from "@/lib/tenancy/context";
import { getEbitda } from "@/lib/tools/ebitda";

// A what-if starts from the sum of this many of the latest complete months (fewer if the brand has fewer).
const BASE_MONTHS = 3;

async function loadTenant(): Promise<TenantContext | null> {
  try {
    return await getTenantContext();
  } catch {
    return null;
  }
}

interface Loaded {
  data: EbitdaData;
  rows: CostSheetRow[]; // the cost sheet's cells for the months shown
  assumptions: CostAssumptions;
}

// Everything the page draws, read for the signed-in brand. The months are get_ebitda's default range, so the chat and this page
// show the same figures.
async function load(ctx: TenantContext): Promise<Loaded> {
  const db = getDb();
  const { data } = await getEbitda(ctx, {}, { db });
  const first = data.months[0]?.month;
  const last = data.months.at(-1)?.month;
  const [rows, rates] = await Promise.all([first !== undefined && last !== undefined ? loadCostSheet(db, ctx.tenantId, { from: first, to: last }) : [], loadAssumptions(db, ctx.tenantId)]);
  return { data, rows, assumptions: rates.assumptions };
}

// ?month=2026-08 picks the month drawn in detail. It has to be one of the months on the page; anything else (a malformed, unknown or
// repeated value) is the latest complete month, or the latest month when none has finished yet.
function chooseMonth(months: EbitdaMonth[], asked: string | string[] | undefined): EbitdaMonth {
  const named = typeof asked === "string" ? months.find((m) => m.month === asked) : undefined;
  return named ?? months.findLast((m) => !m.partial) ?? months[months.length - 1]!;
}

export default async function EbitdaPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const asked = (await searchParams).month;
  const ctx = await loadTenant();
  const heading = <PageHeader title="EBITDA" description="Profit after operating costs, month by month, built from this brand's synced store data and its cost sheet. Each line says where it comes from." />;
  if (!ctx) {
    return (
      <section>
        {heading}
        <ErrorBanner code="FORBIDDEN" role="client_viewer" />
      </section>
    );
  }

  let loaded: Loaded | null = null;
  let failure: ErrorCode = "STORE_DISCONNECTED"; // what a brand with no connected store gets; a connected one replaces it if the read fails
  if (ctx.shop?.status === "connected") {
    try {
      loaded = await load(ctx);
    } catch (e) {
      failure = e instanceof AppError ? e.code : "INTERNAL_ERROR";
    }
  }
  if (!loaded) {
    return (
      <section>
        {heading}
        <ErrorBanner code={failure} role={ctx.role} />
      </section>
    );
  }

  const { data, rows, assumptions } = loaded;
  if (data.months.length === 0) {
    return (
      <section>
        {heading}
        <EmptyState title="No months to show yet">EBITDA is worked out per month from the store&apos;s synced orders. Let the store finish syncing, then come back.</EmptyState>
      </section>
    );
  }

  const canEdit = canEditCostSheet(ctx);
  const currency = ctx.shop?.currency ?? "USD";
  const selected = chooseMonth(data.months, asked);
  // Only complete months go into a what-if: half a month of sales against a full month of costs would mislead.
  const baseMonths = data.months.filter((m) => !m.partial).slice(-BASE_MONTHS);
  const firstBase = baseMonths[0];
  const lastBase = baseMonths[baseMonths.length - 1];

  return (
    <section>
      {heading}
      <div className="space-y-10">
        <section aria-labelledby="bridge-heading">
          <h2 id="bridge-heading" className="section-title">
            Month by month
          </h2>
          <p className="muted mt-1 max-w-[62ch] text-sm">Net sales down to EBITDA for each month. Operating costs come from the cost sheet below, and a month marked as a ceiling is missing some costs.</p>
          <div className="mt-4">
            <BridgeTable months={data.months} selected={selected.month} currency={currency} />
          </div>
        </section>

        <section aria-labelledby="month-heading">
          <h2 id="month-heading" className="section-title">
            {monthName(selected.month)} in detail
          </h2>
          <div className="card card-pad mt-4">
            <Waterfall month={selected} currency={currency} />
          </div>
        </section>

        <section aria-labelledby="receipts-heading">
          <h2 id="receipts-heading" className="section-title">
            Where each line comes from
          </h2>
          <div className="mt-4">
            <Receipts data={data} currency={currency} />
          </div>
        </section>

        <section aria-labelledby="scenario-heading">
          <h2 id="scenario-heading" className="section-title">
            What if
          </h2>
          {firstBase && lastBase ? (
            <>
              <p className="muted mt-1 max-w-[62ch] text-sm">
                Move a lever to see what it would have done to {baseMonths.length === 1 ? `the last complete month, ${monthName(firstBase.month)}` : `the last ${baseMonths.length} complete months, ${monthName(firstBase.month)} to ${monthName(lastBase.month)}`}.
              </p>
              <div className="mt-4">
                <ScenarioPanel
                  base={scenarioBaseOf(baseMonths)}
                  assumptions={assumptions}
                  months={baseMonths.length}
                  currency={currency}
                  baselineIsCeiling={baseMonths.some((m) => m.ebitdaIsCeiling)}
                />
              </div>
            </>
          ) : (
            <p className="muted mt-1 max-w-[62ch] text-sm">A what-if needs at least one complete month of data. Come back when a month has finished.</p>
          )}
        </section>

        <section aria-labelledby="sheet-heading">
          <h2 id="sheet-heading" className="section-title">
            Cost sheet
          </h2>
          <div className="mt-4">
            <CostSheet months={data.months.map((m) => m.month)} rows={rows} assumptions={assumptions} canEdit={canEdit} currency={currency} />
          </div>
        </section>
      </div>
    </section>
  );
}
