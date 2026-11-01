import { Download, Store } from "lucide-react";
import Link from "next/link";
import { exportUrl } from "@/lib/segments/csv";
import type { SegmentId } from "@/lib/segments/definitions";
import { askToCreateUrl } from "./format";

// The two things a person can do with a segment. Both are plain links, so the page needs no client code: the CSV is a download from
// the export route (which checks the role and the brand again), and "create in Shopify" opens the chat, because only the agent's
// propose_action tool can write a proposal to the approval ledger. Nothing here calls Shopify. A disconnected store shows both as
// switched off with the reason in a tooltip.

const OFF = "Reconnect the store first.";

// `hidden` is extra words for a screen reader after the visible label, so several "Download CSV" links on one page can be told apart.
export function DownloadCsvLink({ segment, label, hidden, connected, primary }: { segment?: SegmentId; label: string; hidden?: string; connected: boolean; primary?: boolean }) {
  const className = `btn btn-sm ${primary ? "btn-primary" : "btn-secondary"}`;
  const body = (
    <>
      <Download className="size-3.5" aria-hidden />
      {label}
      {hidden ? <span className="sr-only"> {hidden}</span> : null}
    </>
  );
  if (!connected) {
    return (
      <span role="link" aria-disabled="true" title={OFF} className={className}>
        {body}
      </span>
    );
  }
  return (
    <a href={exportUrl(segment)} download className={className}>
      {body}
    </a>
  );
}

export function CreateInShopifyLink({ segment, title, connected }: { segment: SegmentId; title: string; connected: boolean }) {
  const className = "btn btn-ghost btn-sm";
  const body = (
    <>
      <Store className="size-3.5" aria-hidden />
      Create in Shopify
      <span className="sr-only"> ({title}): opens the chat and asks the agent to propose it for approval</span>
    </>
  );
  if (!connected) {
    return (
      <span role="link" aria-disabled="true" title={OFF} className={className}>
        {body}
      </span>
    );
  }
  return (
    <Link href={askToCreateUrl(segment)} title="Opens the chat and asks the agent to propose this segment. A Growth Capital admin or partner approves it before anything is created in Shopify." className={className}>
      {body}
    </Link>
  );
}
