"use client";

import { useId } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isAllowedLink, provenanceId } from "@/lib/agent/links";
import type { ProvenanceEntry } from "@/lib/agent/run";

// Answers are rendered from an allow-list: no images, no raw HTML (react-markdown drops it), and links only to this app
// and the Shopify admin. A number the checker matched is a button that opens the query behind it.
const ALLOWED = ["p", "strong", "em", "del", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "code", "pre", "blockquote", "h1", "h2", "h3", "h4", "br", "hr", "a"];

const TOOL_NAMES: Record<string, string> = {
  query_metric: "Sales metrics",
  get_orders: "Orders",
  search_products: "Products",
  get_inventory: "Inventory",
  get_customers: "Customers",
  describe_metrics: "Metric definitions",
};

export function toolLabel(name: string): string {
  return TOOL_NAMES[name] ?? name;
}

function ClaimLink({ entry, children }: { entry: ProvenanceEntry | undefined; children: React.ReactNode }) {
  const id = useId();
  if (!entry) return <>{children}</>;
  return (
    <>
      <button type="button" popoverTarget={id} className="cursor-pointer rounded-sm border-b border-dotted border-neutral-500 font-medium hover:bg-neutral-100">
        {children}
      </button>
      <span id={id} popover="auto" role="dialog" className="m-auto w-80 max-w-[90vw] rounded-lg border border-neutral-300 bg-white p-4 text-left text-xs text-neutral-800 shadow-lg">
        <span className="block text-sm font-semibold">{toolLabel(entry.tool)}</span>
        <span className="mt-1 block font-mono text-neutral-500">{entry.queryId}</span>
        <span className="mt-2 block">
          Dates: {entry.range.from} to {entry.range.to}
        </span>
        <span className="block">Data as of: {entry.asOf}</span>
        <span className="mt-2 block break-words font-mono text-neutral-600">{JSON.stringify(entry.input)}</span>
        {entry.truncated ? (
          <span className="mt-2 block">
            Showing {entry.truncated.shown} of {entry.truncated.total}
          </span>
        ) : null}
        {Object.entries(entry.definitions).map(([metric, definition]) => (
          <span key={metric} className="mt-2 block">
            <span className="font-medium">{metric}</span>: {definition}
          </span>
        ))}
      </span>
    </>
  );
}

export function SafeMarkdown({ text, provenance = {} }: { text: string; provenance?: Record<string, ProvenanceEntry> }) {
  return (
    <div className="space-y-3 text-sm leading-6 [&_table]:w-full [&_td]:border-b [&_td]:px-2 [&_td]:py-1 [&_th]:border-b [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        urlTransform={(url) => (provenanceId(url) || isAllowedLink(url) ? url : "")}
        components={{
          a: ({ href, children }) => {
            const id = provenanceId(href);
            if (id) return <ClaimLink entry={provenance[id]}>{children}</ClaimLink>;
            if (href && isAllowedLink(href)) {
              const external = !href.startsWith("/");
              return (
                <a href={href} className="underline" {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
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
