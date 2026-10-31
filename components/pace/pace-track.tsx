// The "pace track": how far a month has got. The solid fill is the actual so far, the tick is the plan so far, the hatched
// extension is the month-end estimate (never drawn solid), and the thin line is the month's target. Every figure is also
// written out below the track, and the track's label says the same in words.
// Used by the Pace page and by the gauge view in chat answers.

type Props = {
  label: string;
  actual: number;
  planned: number;
  target: number;
  projected?: number;
  money: (value: number) => string;
  size?: "lg" | "md";
};

export function PaceTrack({ label, actual, planned, target, projected, money, size = "md" }: Props) {
  // The track runs to whichever is largest, so a beaten target or a high estimate never draws past the end.
  const scale = Math.max(target, actual, planned, projected ?? 0);
  const at = (v: number) => (scale > 0 ? `${Math.min(100, Math.max(0, (v / scale) * 100)).toFixed(2)}%` : "0%");
  const ariaLabel = `${label}: ${money(actual)} of a ${money(target)} target, ${money(planned)} planned so far${projected !== undefined ? `, month-end estimate about ${money(projected)}` : ""}`;
  return (
    <div>
      <div className="py-2">
        <div role="img" aria-label={ariaLabel} className={`relative w-full rounded-full bg-paper-2 ${size === "lg" ? "h-4" : "h-3"}`}>
          {projected !== undefined && projected > actual ? (
            <div className="hatch absolute inset-y-0 left-0 rounded-full border border-dashed border-estimate" style={{ width: at(projected) }} />
          ) : null}
          <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: at(actual) }} />
          <div className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink-3" style={{ left: at(target) }} />
          <div className="absolute -inset-y-1.5 w-[3px] -translate-x-1/2 rounded-full bg-ink ring-2 ring-surface" style={{ left: at(planned) }} />
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="muted flex items-center gap-1.5 text-[13px]">
            <span aria-hidden className="h-2.5 w-4 shrink-0 rounded-full bg-brand" />
            So far
          </dt>
          <dd className="num mt-0.5 font-medium">{money(actual)}</dd>
        </div>
        <div>
          <dt className="muted flex items-center gap-1.5 text-[13px]">
            <span aria-hidden className="h-3.5 w-[3px] shrink-0 rounded-full bg-ink" />
            Plan so far
          </dt>
          <dd className="num mt-0.5 font-medium">{money(planned)}</dd>
        </div>
        <div>
          <dt className="muted flex items-center gap-1.5 text-[13px]">
            <span aria-hidden className="h-3.5 w-0.5 shrink-0 rounded-full bg-ink-3" />
            Target for the month
          </dt>
          <dd className="num mt-0.5 font-medium">{money(target)}</dd>
        </div>
      </dl>
      {projected !== undefined ? (
        <p className="mt-4 flex items-start gap-2.5 text-sm">
          <span aria-hidden className="hatch mt-1 h-3 w-6 shrink-0 rounded-full border border-dashed border-estimate" />
          <span>
            On this pace the month lands at about <span className="num font-semibold">{money(projected)}</span> <span className="muted">(estimate)</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}
