import { sparkGeometry } from "./spark-geometry";

// A tiny trend line for a tile or a table row. Brand colour for what happened, a thin grey line for the plan, a ring on the last point.
// The line draws itself once on load (CSS, see .spark-line in globals.css) and is simply drawn under reduced motion. `label` is the
// text alternative: say the first and last values in words (see sparkLabel).
export function Sparkline({ values, plan, label, width = 112, height = 36, className }: { values: readonly number[]; plan?: readonly number[]; label: string; width?: number; height?: number; className?: string }) {
  const geo = sparkGeometry(values, { width, height, pad: 4, plan });
  if (!geo) return null;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className={`block shrink-0 overflow-visible ${className ?? ""}`}>
      {geo.plan ? <path d={geo.plan} fill="none" className="stroke-plan" strokeOpacity={0.6} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" /> : null}
      <path d={geo.line} pathLength={1} fill="none" className="spark-line stroke-brand" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={geo.last.x} cy={geo.last.y} r={3} className="spark-dot fill-surface stroke-brand" strokeWidth={2} />
    </svg>
  );
}
