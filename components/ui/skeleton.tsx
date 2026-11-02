import type { ReactNode } from "react";

// The shapes shown while a page loads: grey blocks where text, cards, charts and rows will land, sized like the real thing so nothing
// jumps when the content arrives. The shimmer is the .skeleton class in globals.css and stops under reduced motion. Wrap a whole
// loading screen in PageSkeleton, which tells assistive tech the page is busy once and hides the grey blocks from it.

const join = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

// A block of any size: pass the height and width as classes.
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={join("skeleton", className)} />;
}

// One line of text (the height of body copy).
export function SkeletonLine({ className = "w-full" }: { className?: string }) {
  return <Skeleton className={join("h-4", className)} />;
}

// Where a chart goes.
export function SkeletonChart({ className = "h-48" }: { className?: string }) {
  return <Skeleton className={join("rounded-xl", className)} />;
}

const WIDTHS = ["w-full", "w-5/6", "w-2/3", "w-3/4"];

// A card with a title line and either the given content or a few lines of text.
export function SkeletonCard({ lines = 3, className, children }: { lines?: number; className?: string; children?: ReactNode }) {
  return (
    <div aria-hidden className={join("card card-pad", className)}>
      <Skeleton className="mb-3 h-5 w-40 max-w-full" />
      {children ?? (
        <div className="space-y-3">
          {Array.from({ length: lines }, (_, i) => (
            <SkeletonLine key={i} className={WIDTHS[i % WIDTHS.length]} />
          ))}
        </div>
      )}
    </div>
  );
}

// List rows: a round icon, two lines of text and a button, like the rows in Waiting for you or Actions.
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={join("divide-y divide-line", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3">
          <Skeleton className="size-[34px] shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonLine className="w-3/5" />
            <SkeletonLine className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0 rounded-lg" />
        </div>
      ))}
    </div>
  );
}

// Table rows: a head row and `rows` body rows of `cols` cells, inside a card that scrolls sideways like the real tables.
export function SkeletonTable({ rows = 5, cols = 4, minWidth = 560 }: { rows?: number; cols?: number; minWidth?: number }) {
  return (
    <div aria-hidden className="card overflow-x-auto">
      <div className="divide-y divide-line px-[0.9rem]" style={{ minWidth }}>
        {Array.from({ length: rows + 1 }, (_, r) => (
          <div key={r} className="flex items-center gap-6 py-3.5">
            {Array.from({ length: cols }, (_, c) => (
              <SkeletonLine key={c} className={join(r === 0 ? "h-3" : "", c === 0 ? "w-1/4" : "flex-1")} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// The frame of a loading screen: the page title block (unless `header` is false), then the body. role="status" with a visually hidden
// "Loading" is what a screen reader announces; the grey blocks themselves are hidden from it.
export function PageSkeleton({
  header = true,
  description = true,
  actions = false,
  className,
  bodyClassName,
  children,
}: {
  header?: boolean;
  description?: boolean;
  actions?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">Loading</span>
      {header ? (
        <div aria-hidden className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <Skeleton className="h-[34px] w-48 max-w-full" />
            {description ? <Skeleton className="mt-2 h-[23px] w-[34rem] max-w-full" /> : null}
          </div>
          {actions ? <Skeleton className="h-10 w-36 rounded-[10px]" /> : null}
        </div>
      ) : null}
      <div aria-hidden className={bodyClassName}>
        {children}
      </div>
    </div>
  );
}
