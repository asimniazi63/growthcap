import type { Mode, SchemeId } from "@/lib/appearance/schemes";

// A miniature of the app. It carries its own data-scheme and data-mode, so every token below resolves to that scheme's colours
// whatever scheme the page itself is in. Purely decorative, so it is hidden from screen readers.
export function SchemeThumb({ scheme, mode }: { scheme: SchemeId; mode: Mode }) {
  return (
    <div aria-hidden="true" data-scheme={scheme} data-mode={mode} className="grid h-[138px] grid-cols-[24%_minmax(0,1fr)] overflow-hidden rounded-[10px] border border-line bg-paper text-ink">
      <div className="flex flex-col gap-1.5 border-r border-line bg-rail px-2 py-3 text-on-rail">
        <i className="mb-1 block h-2 w-3/5 rounded-[3px] bg-brand" />
        <i className="block h-1.5 rounded-[3px] bg-brand" />
        <i className="block h-1.5 rounded-[3px] bg-current opacity-30" />
        <i className="block h-1.5 rounded-[3px] bg-current opacity-30" />
        <i className="block h-1.5 rounded-[3px] bg-current opacity-30" />
      </div>
      <div className="flex min-w-0 flex-col gap-[7px] px-3 py-[11px]">
        <div className="h-[9px] w-[78%] rounded-[3px] bg-ink" />
        <div className="h-1.5 w-[46%] rounded-[3px] bg-ink-3" />
        <div className="min-h-0 flex-1 rounded-lg border border-line bg-surface">
          <svg viewBox="0 0 100 44" preserveAspectRatio="none" className="block size-full">
            {/* the plan, then what has happened so far, then the dashed estimate, with the gap to plan shaded along the bottom */}
            <path d="M0 36 L100 12" fill="none" strokeWidth={1.6} vectorEffect="non-scaling-stroke" className="stroke-plan" />
            <path d="M0 37 L18 32 L34 29 L50 22" fill="none" strokeWidth={2.2} vectorEffect="non-scaling-stroke" className="stroke-brand" />
            <path d="M50 22 L100 6" fill="none" strokeWidth={2.2} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" className="stroke-brand" />
            <path d="M0 44 L0 41 L18 40 L34 38 L50 35 L50 44Z" className="fill-ahead/45" />
          </svg>
        </div>
        <div className="flex gap-1.5">
          <span className="h-3 w-[38px] rounded-full bg-brand" />
          <span className="h-3 w-[26px] rounded bg-ahead-tint" />
          <span className="h-3 w-[26px] rounded bg-behind-tint" />
        </div>
      </div>
    </div>
  );
}
