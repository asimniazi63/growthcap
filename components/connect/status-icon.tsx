import { AlertTriangle, Check, Clock, Minus } from "lucide-react";

export type IconTone = "ok" | "warn" | "off" | "none";

const STYLE: Record<IconTone, { box: string; label: string }> = {
  ok: { box: "bg-ahead-tint text-ahead", label: "OK" },
  warn: { box: "bg-warn-tint text-warn", label: "Worth a look" },
  off: { box: "bg-paper-2 text-ink-3", label: "Scheduled" },
  none: { box: "bg-paper-2 text-ink-3", label: "Not granted" },
};

// A round status marker. The icon differs by tone and a screen-reader label says the same, so colour is never the only signal.
export function StatusIcon({ tone }: { tone: IconTone }) {
  const Icon = tone === "ok" ? Check : tone === "warn" ? AlertTriangle : tone === "off" ? Clock : Minus;
  return (
    <span className={`grid size-[26px] shrink-0 place-items-center rounded-full ${STYLE[tone].box}`}>
      <Icon className="size-3.5" strokeWidth={2.6} aria-hidden />
      <span className="sr-only">{STYLE[tone].label}</span>
    </span>
  );
}

// A row inside a health card: marker, label with an optional line under it, and the value on the right.
export function HealthRow({ tone, label, detail, children }: { tone: IconTone; label: string; detail?: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 text-sm last:border-b-0">
      <StatusIcon tone={tone} />
      <div className="min-w-[9rem] flex-1">
        <p className="text-ink">{label}</p>
        {detail ? <p className="faint mt-0.5 text-xs">{detail}</p> : null}
      </div>
      <div className="num shrink-0 text-right font-semibold text-ink">{children}</div>
    </li>
  );
}
