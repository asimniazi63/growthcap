import { json, readJson, withTenant } from "@/lib/api/respond";
import { getDb, type Db } from "@/lib/db/client";
import { assertCanEditCostSheet } from "@/lib/ebitda/access";
import { costEditSchema } from "@/lib/ebitda/costs-input";
import { deleteCostCell, upsertAssumptions, upsertCostCell } from "@/lib/ebitda/store";
import { AppError } from "@/lib/errors";
import { monthOf } from "@/lib/metrics/dates";
import { monthName } from "@/lib/pace/format";
import type { TenantContext } from "@/lib/tenancy/context";
import { loadWindow, todayFor } from "@/lib/tools/common";
import { requireConnectedShop } from "@/lib/tools/result";

export const runtime = "nodejs";
export const maxDuration = 30;

// A cell is taken for a month the page can show: from the month of the brand's first synced order to the store's current month
// ("today" is the store's own, as in every tool). Anything outside that would be saved, never appear on the sheet and never reach a
// bridge, so it is refused instead.
async function assertMonthInWindow(db: Db, ctx: TenantContext, month: string, timezone: string): Promise<void> {
  const win = await loadWindow(db, ctx.tenantId);
  if (!win.first) throw new AppError("INVALID_INPUT", "This brand has no synced orders yet, so there is no month to enter costs for.");
  const first = monthOf(win.first);
  const current = monthOf(todayFor(timezone, win));
  if (month < first || month > current) throw new AppError("INVALID_INPUT", `Costs can be entered from ${monthName(first)} to ${monthName(current)}; ${monthName(month)} is outside that.`);
}

// A Growth Capital admin or partner changes or removes one cell of the signed-in brand's cost sheet, or changes its card-fee and
// fulfilment rates. A cell with a null amount is removed, whatever its source, which is how a mistaken edit goes back to "not entered"
// or, after a reload of the seed file, to its seeded value. The brand and the person come from the Clerk session, never from the body:
// the schema is strict, so a body that names a tenant is refused. The role is checked before the body is read, and a removal takes the
// same month window as a save. The edit is a direct write marked as typed in by a person, not an approval card.
export const PUT = (request: Request) =>
  withTenant(async (ctx) => {
    assertCanEditCostSheet(ctx);
    const parsed = costEditSchema.safeParse(await readJson(request, 1_000));
    if (!parsed.success) throw new AppError("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join(" "));
    const edit = parsed.data;
    const shop = requireConnectedShop(ctx);
    const db = getDb();
    if (edit.kind === "cell") {
      await assertMonthInWindow(db, ctx, edit.month, shop.timezone);
      if (edit.amountCents === null) await deleteCostCell(db, ctx.tenantId, { month: edit.month, category: edit.category });
      else await upsertCostCell(db, ctx.tenantId, ctx.userId, { month: edit.month, category: edit.category, amountCents: edit.amountCents });
    } else {
      await upsertAssumptions(db, ctx.tenantId, ctx.userId, {
        cardFeeBps: edit.cardFeeBps,
        cardFeeFixedCents: edit.cardFeeFixedCents,
        fulfilmentCentsPerOrder: edit.fulfilmentCentsPerOrder,
      });
    }
    return json({ ok: true });
  });
