// The drawing maths for Sparkline: values in, SVG path text out. The scale starts at 0 (or lower, for a negative value), so a small
// wiggle never looks like a big swing, and the line and the plan share one scale so the gap between them is the real gap.

export interface SparkGeometry {
  line: string;
  plan: string | null;
  last: { x: number; y: number };
}

const fmt = (n: number) => n.toFixed(1);

export function sparkGeometry(values: readonly number[], opts: { width: number; height: number; pad: number; plan?: readonly number[] }): SparkGeometry | null {
  const { width, height, pad } = opts;
  const plan = opts.plan && opts.plan.length === values.length ? opts.plan : null;
  if (values.length < 2 || ![...values, ...(plan ?? [])].every(Number.isFinite)) return null;

  const all = plan ? [...values, ...plan] : values;
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const span = hi - lo;
  const x = (i: number) => pad + (i / (values.length - 1)) * (width - 2 * pad);
  const y = (v: number) => (span === 0 ? height - pad : height - pad - ((v - lo) / span) * (height - 2 * pad));
  const path = (vs: readonly number[]) => vs.map((v, i) => `${i === 0 ? "M" : "L"}${fmt(x(i))} ${fmt(y(v))}`).join(" ");

  const end = values.length - 1;
  return { line: path(values), plan: plan ? path(plan) : null, last: { x: x(end), y: y(values[end]!) } };
}
