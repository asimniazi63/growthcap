"use client";

import { Check, X } from "lucide-react";
import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isAllowedLink, provenanceId } from "@/lib/agent/links";
import type { ProvenanceEntry } from "@/lib/agent/run";

// Answers are rendered from an allow-list: no images, no raw HTML (react-markdown drops it), and links only to this app
// and the Shopify admin. A number the checker matched is a button that opens the query behind it.
const ALLOWED = ["p", "strong", "em", "del", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "code", "pre", "blockquote", "h1", "h2", "h3", "h4", "br", "hr", "a"];

// Friendly names for every tool the assistant can call (the main agent's, the "why did we miss plan" investigators' and
// the ones that draw or propose something). A name that is not listed falls back to the raw tool name.
const TOOL_NAMES: Record<string, string> = {
  query_metric: "Sales metrics",
  get_orders: "Orders",
  search_products: "Products",
  get_inventory: "Inventory",
  get_customers: "Customers",
  describe_metrics: "Metric definitions",
  explain_gap: "Why the month missed plan",
  zero_sales_days: "Days with no sales",
  get_calendar: "Marketing calendar",
  get_notes: "Call notes",
  render_view: "Chart or table",
  remember: "Note for this brand",
  propose_action: "Proposed change",
  draft_landing_page: "Landing page draft",
};

export function toolLabel(name: string): string {
  return TOOL_NAMES[name] ?? name;
}

function ClaimLink({ entry, children }: { entry: ProvenanceEntry | undefined; children: ReactNode }) {
  const id = useId();
  if (!entry) return <>{children}</>;
  const filters = JSON.stringify(entry.input);
  return (
    <>
      <button type="button" popoverTarget={id} className="verified-figure">
        {children}
      </button>
      {/* The popover element itself must not get a display class: the browser hides it with display:none until it opens. */}
      <span id={id} popover="auto" role="dialog" aria-label={`Source: ${toolLabel(entry.tool)}`} className="m-auto w-[23rem] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-surface p-0 text-left text-xs text-ink shadow-pop backdrop:bg-ink/20">
        <span className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-tint text-brand-strong">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
          </span>
          <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold">{toolLabel(entry.tool)}</span>
          <span className="badge max-w-[9rem] truncate font-mono text-[0.6875rem] font-medium">{entry.queryId}</span>
          <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close source" className="btn btn-ghost -mr-1.5 p-1">
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
        <span className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 px-4 py-3">
          <span className="text-ink-3">Dates</span>
          <span className="num">
            {entry.range.from} to {entry.range.to}
          </span>
          <span className="text-ink-3">Data as of</span>
          <span className="num break-words">{entry.asOf}</span>
          <span className="text-ink-3">Filters</span>
          <span className="break-words font-mono text-[0.6875rem] leading-5 text-ink-2">{filters}</span>
          {entry.truncated ? (
            <>
              <span className="text-ink-3">Rows</span>
              <span className="num">
                Showing {entry.truncated.shown} of {entry.truncated.total}
              </span>
            </>
          ) : null}
        </span>
        {Object.keys(entry.definitions).length > 0 ? (
          <span className="block space-y-1.5 border-t border-line bg-paper px-4 py-3 text-ink-2">
            {Object.entries(entry.definitions).map(([metric, definition]) => (
              <span key={metric} className="block">
                <span className="font-medium text-ink">{metric}</span>: {definition}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </>
  );
}

// The text inside a table cell, so a column of figures can be right-aligned.
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

const FIGURE = /^[\s\-+−–~≈]*[$€£]?\s*[\d][\d,.\s]*(?:[kKmM]|%|\s?(?:pts?|x|×))?\s*$/;

type Cell = ReactElement<{ className?: string; children?: ReactNode }>;

// Money, counts and rates line up on the right: a column counts as numeric when most of its body cells read as figures.
function AlignedTable({ children }: { children?: ReactNode }) {
  const sections = Children.toArray(children) as ReactElement<{ children?: ReactNode }>[];
  const body = sections.find((s) => isValidElement(s) && s.type === "tbody");
  const rows = Children.toArray(body?.props.children) as ReactElement<{ children?: ReactNode }>[];
  const tally: { figures: number; total: number }[] = [];
  for (const row of rows) {
    Children.toArray(row.props?.children).forEach((cell, i) => {
      tally[i] ??= { figures: 0, total: 0 };
      tally[i].total += 1;
      if (FIGURE.test(textOf(cell))) tally[i].figures += 1;
    });
  }
  const numeric = tally.map((t) => t.total > 0 && t.figures / t.total >= 0.6);

  const alignRow = (row: ReactElement<{ children?: ReactNode }>) =>
    isValidElement(row)
      ? cloneElement(
          row,
          undefined,
          Children.toArray(row.props.children).map((cell, i) => (isValidElement(cell) && numeric[i] ? cloneElement(cell as Cell, { className: "num" }) : cell)),
        )
      : row;
  const alignSection = (section: ReactElement<{ children?: ReactNode }>) =>
    isValidElement(section) ? cloneElement(section, undefined, Children.toArray(section.props.children).map((row) => alignRow(row as ReactElement<{ children?: ReactNode }>))) : section;

  return (
    <div className="card my-1 overflow-x-auto">
      <table className="data-table">{sections.map((s) => alignSection(s))}</table>
    </div>
  );
}

const PROSE_WIDTH = "max-w-[70ch]";

export function SafeMarkdown({ text, provenance = {} }: { text: string; provenance?: Record<string, ProvenanceEntry> }) {
  return (
    <div className="space-y-3.5 text-[0.9375rem] leading-7 text-ink [&>:first-child]:mt-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        urlTransform={(url) => (provenanceId(url) || isAllowedLink(url) ? url : "")}
        components={{
          p: ({ children }) => <p className={PROSE_WIDTH}>{children}</p>,
          h1: ({ children }) => <h2 className={`${PROSE_WIDTH} pt-2 text-xl font-semibold leading-snug`}>{children}</h2>,
          h2: ({ children }) => <h3 className={`${PROSE_WIDTH} pt-2 text-lg font-semibold leading-snug`}>{children}</h3>,
          h3: ({ children }) => <h4 className={`${PROSE_WIDTH} pt-1 font-display text-base font-semibold leading-snug`}>{children}</h4>,
          h4: ({ children }) => <h5 className={`${PROSE_WIDTH} pt-1 text-sm font-semibold text-ink-2`}>{children}</h5>,
          ul: ({ children }) => <ul className={`${PROSE_WIDTH} list-disc space-y-1.5 pl-5 marker:text-ink-3`}>{children}</ul>,
          ol: ({ children }) => <ol className={`${PROSE_WIDTH} list-decimal space-y-1.5 pl-5 marker:text-ink-3`}>{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          blockquote: ({ children }) => <blockquote className={`${PROSE_WIDTH} border-l-2 border-line-strong pl-4 text-ink-2`}>{children}</blockquote>,
          hr: () => <hr className="border-line" />,
          code: ({ children }) => <code className="rounded-md bg-paper-2 px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>,
          pre: ({ children }) => <pre className="inset overflow-x-auto p-3 font-mono text-xs leading-5 [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
          table: ({ children }) => <AlignedTable>{children}</AlignedTable>,
          a: ({ href, children }) => {
            const id = provenanceId(href);
            if (id) return <ClaimLink entry={provenance[id]}>{children}</ClaimLink>;
            if (href && isAllowedLink(href)) {
              const external = !href.startsWith("/");
              return (
                <a href={href} className="font-medium text-brand-strong underline decoration-brand/40 underline-offset-2 hover:decoration-brand" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {children}
                </a>
              );
            }
            return <>{children}</>;
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
