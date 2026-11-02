import { TriangleAlert } from "lucide-react";

// What the tool said to read with care, shown under the chart as plain text. Some of it quotes store text (a discount code), so
// it is only ever rendered as text.
export function CaveatsNote({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div role="note" className="mt-3 flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-tint px-3.5 py-2.5 text-[13px] text-warn">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <ul className="space-y-1">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
