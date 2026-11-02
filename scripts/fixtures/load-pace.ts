// Loads a store's plan.csv and ad-spend.csv into its tenant (T6). Both files are checked in full before anything is written,
// so a bad row stores nothing, and both loads can be run again: the same file leaves the same rows.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../lib/db/client";
import { adSpend, planTargets, plans } from "../../lib/db/schema";
import { PLAN_METRICS, type PlanMetric } from "../../lib/pace/metrics";

export const AD_CHANNELS = ["meta", "google", "tiktok"] as const;

export interface AdSpendRow {
  date: string;
  channel: (typeof AD_CHANNELS)[number];
  spendCents: number;
}
export interface PlanTargetRow {
  month: string;
  metric: PlanMetric;
  value: number;
}

export function readFixtureFile(store: string, name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/${store}/${name}`, import.meta.url)), "utf8");
}

interface CsvRow {
  line: number; // the line in the file, counting the comment lines
  cells: string[];
}

// The fixtures have no quoted cells. Comment lines (the FICTIONAL SAMPLE line) and blank lines are skipped.
export function readRows(text: string, header: readonly string[]): CsvRow[] {
  const rows: CsvRow[] = [];
  let sawHeader = false;
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (line.trim() === "" || line.startsWith("#")) return;
    const cells = line.split(",").map((c) => c.trim());
    if (!sawHeader) {
      if (cells.join(",") !== header.join(",")) throw new Error(`Expected the header "${header.join(",")}" but found "${line}" on line ${i + 1}.`);
      sawHeader = true;
      return;
    }
    if (cells.length !== header.length) throw new Error(`Line ${i + 1}: expected ${header.length} columns but found ${cells.length}.`);
    rows.push({ line: i + 1, cells });
  });
  if (!sawHeader) throw new Error(`The file is empty: expected the header "${header.join(",")}".`);
  return rows;
}

function realDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const realMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const wholeNumber = (s: string) => /^\d+$/.test(s);
const fraction = (s: string) => /^(\d+(\.\d+)?|\.\d+)$/.test(s) && Number(s) <= 1;

export function parseAdSpend(text: string): AdSpendRow[] {
  const seen = new Set<string>();
  return readRows(text, ["date", "channel", "spend"]).map(({ line, cells: [date, channel, spend] }) => {
    if (!realDay(date!)) throw new Error(`Line ${line}: "${date}" is not a date (YYYY-MM-DD).`);
    if (!(AD_CHANNELS as readonly string[]).includes(channel!)) throw new Error(`Line ${line}: "${channel}" is not a channel we know (${AD_CHANNELS.join(", ")}).`);
    if (!wholeNumber(spend!)) throw new Error(`Line ${line}: spend "${spend}" must be a whole number of cents, zero or more.`);
    const key = `${date}|${channel}`;
    if (seen.has(key)) throw new Error(`Line ${line}: ${channel} on ${date} appears twice.`);
    seen.add(key);
    return { date: date!, channel: channel as AdSpendRow["channel"], spendCents: Number(spend) };
  });
}

export function parsePlan(text: string): PlanTargetRow[] {
  const seen = new Set<string>();
  return readRows(text, ["month", "net_sales", "orders", "new_customer_orders", "aov", "returning_customer_rate"]).flatMap(({ line, cells }) => {
    const [month, ...values] = cells;
    if (!realMonth(month!)) throw new Error(`Line ${line}: "${month}" is not a month (YYYY-MM).`);
    if (seen.has(month!)) throw new Error(`Line ${line}: ${month} appears twice.`);
    seen.add(month!);
    return PLAN_METRICS.map((metric, i): PlanTargetRow => {
      const raw = values[i]!;
      const ok = metric === "returning_customer_rate" ? fraction(raw) : wholeNumber(raw);
      if (!ok) throw new Error(`Line ${line}: ${metric} "${raw}" must be ${metric === "returning_customer_rate" ? "a fraction from 0 to 1" : "a whole number, zero or more"}.`);
      return { month: month!, metric, value: Number(raw) };
    });
  });
}

const CHUNK = 500;
const chunks = <T>(items: T[]): T[][] => Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK));

export async function loadAdSpend(db: Db, tenantId: string, csv: string): Promise<{ rows: number }> {
  const parsed = parseAdSpend(csv);
  await db.transaction(async (tx) => {
    for (const part of chunks(parsed)) {
      await tx
        .insert(adSpend)
        .values(part.map((r) => ({ tenantId, date: r.date, channel: r.channel, spendCents: r.spendCents })))
        .onConflictDoUpdate({ target: [adSpend.tenantId, adSpend.date, adSpend.channel], set: { spendCents: sql`excluded.spend_cents` } });
    }
  });
  return { rows: parsed.length };
}

// Only the fixture plan is managed here: an uploaded plan is never touched by a fixture reload.
export async function loadPlan(db: Db, tenantId: string, csv: string, label: string): Promise<{ planId: string; months: number }> {
  const targets = parsePlan(csv);
  const planId = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(plans).where(and(eq(plans.tenantId, tenantId), eq(plans.source, "fixture"))).limit(1);
    let id = existing?.id;
    if (id) {
      await tx.delete(planTargets).where(and(eq(planTargets.tenantId, tenantId), eq(planTargets.planId, id)));
      await tx.update(plans).set({ label }).where(eq(plans.id, id));
    } else {
      const [anyActive] = await tx.select({ id: plans.id }).from(plans).where(and(eq(plans.tenantId, tenantId), eq(plans.active, true))).limit(1);
      const [created] = await tx.insert(plans).values({ tenantId, label, source: "fixture", active: !anyActive }).returning({ id: plans.id });
      id = created!.id;
    }
    for (const part of chunks(targets)) await tx.insert(planTargets).values(part.map((t) => ({ tenantId, planId: id!, month: t.month, metric: t.metric, value: t.value })));
    return id;
  });
  return { planId, months: new Set(targets.map((t) => t.month)).size };
}
