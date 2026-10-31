import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

// An empty screen says what is missing and what to do about it.
export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      {Icon ? (
        <span className="mb-3 grid size-10 place-items-center rounded-full bg-brand-tint text-brand-strong">
          <Icon className="size-5" aria-hidden />
        </span>
      ) : null}
      <p className="section-title">{title}</p>
      {children ? <div className="muted mt-1 max-w-md text-sm">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
