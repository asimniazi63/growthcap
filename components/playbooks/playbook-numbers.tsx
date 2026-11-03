import { getDb } from "@/lib/db/client";
import { loadNumbers, type NumbersItem } from "@/lib/playbooks/numbers";
import type { PlaybookRunView } from "@/lib/playbooks/store";
import type { TenantContext } from "@/lib/tenancy/context";
import { NumbersPanel } from "./numbers-panel";

// Reads the live numbers for one playbook run and draws them. A server component: it runs the views' queries for the signed-in brand
// (the tenant comes from the session in `ctx`) when the page opens. The page wraps it in Suspense, so the write-up shows at once and
// the numbers follow. It never throws: a view that cannot be drawn is said so in the panel, and a failure to reach the database leaves
// the write-up alone.
export async function PlaybookNumbers({ ctx, run }: { ctx: TenantContext; run: PlaybookRunView }) {
  let items: NumbersItem[] | null = null;
  try {
    items = await loadNumbers(ctx, run, { db: getDb() });
  } catch {
    items = null;
  }
  return items ? <NumbersPanel items={items} currency={ctx.shop?.currency ?? "USD"} /> : null;
}
