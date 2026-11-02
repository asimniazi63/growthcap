import { ArrowDownRight, ArrowUpRight, CircleCheck, Gauge, Minus } from "lucide-react";
import { formatGap, formatPct, formatValue, type Tone } from "@/lib/pace/format";
import type { PlanGap } from "@/lib/pace/gap";
import type { PlanMetric } from "@/lib/pace/metrics";
import { METRICS } from "@/lib/metrics/registry";

// The ahead and behind chips and the "need a day" line, shared by the Pace panel and the hero that the scrubber drives.

export const TEXT_TONE: Record<Tone, string> = { ahead: "text-ahead", behind: "text-behind", even: "muted" };
const BADGE_TONE: Record<Tone, string> = { ahead: "badge-ahead", behind: "badge-behind", even: "" };
export const ICON: Record<Tone, typeof Minus> = { ahead: ArrowUpRight, behind: ArrowDownRight, even: Minus };

export function gapText(metric: PlanMetric, g: PlanGap, currency: string) {
  const gap = formatGap(metric, g.gap, currency);
  const pct = formatPct(g.pctGap);
  return { tone: gap.tone, text: gap.text, pct: pct && METRICS[metric].unit !== "rate" ? ` (${pct})` : "" };
}

const NEED_NOUN: Partial<Record<PlanMetric, string>> = { orders: " orders", new_customer_orders: " new-customer orders" };

// "Need $54.20 a day for the rest of the month", from the plan gap the tool returned (so the figure is one the checker can match).
// Absent once the month is over; says so when the target is already met.
function needLine(metric: PlanMetric, g: PlanGap, currency: string): { text: string; met: boolean } | null {
  if (g.neededPerDay !== undefined) return { text: `Need ${formatValue(metric, g.neededPerDay, currency)}${NEED_NOUN[metric] ?? ""} a day for the rest of the month`, met: false };
  if (g.targetMet) return { text: "Target for the month already met", met: true };
  return null;
}

export function NeedBadge({ metric, g, currency, className = "" }: { metric: PlanMetric; g: PlanGap; currency: string; className?: string }) {
  const need = needLine(metric, g, currency);
  if (!need) return null;
  const Icon = need.met ? CircleCheck : Gauge;
  return (
    <p className={`flex items-start gap-1.5 font-medium ${need.met ? "text-ahead" : "text-ink-2"} ${className}`}>
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{need.text}</span>
    </p>
  );
}

// The gap as a chip: colour and an arrow say ahead or behind, the words say by how much.
export function GapBadge({ metric, g, currency }: { metric: PlanMetric; g: PlanGap; currency: string }) {
  const { tone, text, pct } = gapText(metric, g, currency);
  const Icon = ICON[tone];
  return (
    <span className={`badge ${BADGE_TONE[tone]} max-w-full text-[13px]`}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>
        {text}
        {pct}
      </span>
    </span>
  );
}
