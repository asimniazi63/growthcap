import { and, eq, max } from "drizzle-orm";
import vercelConfig from "../../vercel.json";
import type { Db } from "../db/client";
import { webhookEvents } from "../db/schema";

// Data older than this is flagged. It matches the 36 hours lib/clock.ts uses to decide a demo store has gone quiet.
export const STALE_AFTER_HOURS = 36;
export const REFRESH_CRON_PATH = "/api/cron/refresh";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The next time the daily sync runs, read from the same vercel.json Vercel Cron uses. Only the "M H * * *" form is
// understood; anything else returns null rather than a guess.
export function nextDailySync(now: Date, crons: readonly { path: string; schedule: string }[] = vercelConfig.crons): Date | null {
  const job = crons.find((c) => c.path === REFRESH_CRON_PATH);
  const m = job?.schedule.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (minute > 59 || hour > 23) return null;
  let next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute);
  if (next <= now.getTime()) next += DAY_MS;
  return new Date(next);
}

export function hoursSince(then: Date | null, now: Date): number | null {
  return then ? Math.max(0, (now.getTime() - then.getTime()) / HOUR_MS) : null;
}

export function isStale(then: Date | null, now: Date): boolean {
  const hours = hoursSince(then, now);
  return hours === null || hours > STALE_AFTER_HOURS;
}

// "Under 1 hour", "1 hour", "5 hours".
export function lagLabel(hours: number): string {
  if (hours < 1) return "Under 1 hour";
  const whole = Math.floor(hours);
  return `${whole} ${whole === 1 ? "hour" : "hours"}`;
}

export interface Freshness {
  asOf: Date | null; // when an order row was last written, by a sync or a webhook
  lastOrderWebhookAt: Date | null; // latest orders/create delivery for this store
  webhookFailed: boolean; // the webhook lookup itself failed (so null does not mean "none yet")
  nextSyncAt: Date | null;
  lagHours: number | null;
  stale: boolean;
}

// The shop domain comes from the signed-in session's tenant, never from a request. webhook_events has no tenant column,
// only the shop domain Shopify sent (HMAC-verified on arrival).
export async function getFreshness(db: Db, input: { shopDomain: string; asOf: Date | null; now: Date }): Promise<Freshness> {
  const { shopDomain, asOf, now } = input;
  let lastOrderWebhookAt: Date | null = null;
  let webhookFailed = false;
  try {
    const [row] = await db
      .select({ at: max(webhookEvents.receivedAt) })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.shopDomain, shopDomain), eq(webhookEvents.topic, "orders/create")));
    lastOrderWebhookAt = row?.at ? new Date(row.at) : null;
  } catch {
    webhookFailed = true;
  }
  return { asOf, lastOrderWebhookAt, webhookFailed, nextSyncAt: nextDailySync(now), lagHours: hoursSince(asOf, now), stale: isStale(asOf, now) };
}
