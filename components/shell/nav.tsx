"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Gauge, LayoutDashboard, LayoutGrid, ListChecks, MessagesSquare, Newspaper, Plug, ScanSearch, type LucideIcon } from "lucide-react";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
}

// Ask the agent, track the numbers, act on what they say.
const GROUPS: { label: string; items: Item[] }[] = [
  { label: "", items: [{ href: "/overview", label: "Overview", icon: LayoutDashboard }] },
  { label: "Ask", items: [{ href: "/chat", label: "Chat", icon: MessagesSquare }] },
  {
    label: "Track",
    items: [
      { href: "/pace", label: "Pace", icon: Gauge },
      { href: "/portfolio", label: "Portfolio", icon: LayoutGrid },
      { href: "/briefs", label: "Briefs", icon: Newspaper },
      { href: "/audit", label: "Audit", icon: ScanSearch },
    ],
  },
  {
    label: "Act",
    items: [
      { href: "/plan", label: "Plan", icon: FileText },
      { href: "/actions", label: "Actions", icon: ListChecks },
    ],
  },
];
const CONNECT: Item = { href: "/connect", label: "Connect", icon: Plug };

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function SideLink({ item, pathname, pending = 0 }: { item: Item; pathname: string; pending?: number }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-ink-2 hover:bg-paper-2 hover:text-ink"
      }`}
    >
      <Icon className={`size-[1.125rem] ${active ? "text-brand" : "text-ink-3"}`} aria-hidden />
      {item.label}
      {pending > 0 && item.href === "/actions" ? (
        <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-xs font-bold text-on-brand">
          {pending}
          <span className="sr-only"> waiting for approval</span>
        </span>
      ) : null}
    </Link>
  );
}

function TopLink({ item, pathname, pending = 0 }: { item: Item; pathname: string; pending?: number }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-tint text-brand-strong" : "text-ink-2 hover:bg-paper-2"}`}
    >
      <Icon className="size-4" aria-hidden />
      {item.label}
      {pending > 0 && item.href === "/actions" ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[0.6875rem] font-bold text-on-brand">{pending}</span> : null}
    </Link>
  );
}

export function Nav({ variant, pending = 0 }: { variant: "side" | "top"; pending?: number }) {
  const pathname = usePathname() ?? "";

  if (variant === "top") {
    return (
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] lg:hidden">
        {[...GROUPS.flatMap((g) => g.items), CONNECT].map((item) => (
          <TopLink key={item.href} item={item} pathname={pathname} pending={pending} />
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="flex flex-1 flex-col">
      {GROUPS.map((g) => (
        <div key={g.label} className="mb-5">
          {g.label ? <p className="px-3 pb-1.5 text-xs font-medium text-ink-3">{g.label}</p> : null}
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <li key={item.href}>
                <SideLink item={item} pathname={pathname} pending={pending} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="mt-auto">
        <SideLink item={CONNECT} pathname={pathname} />
      </div>
    </nav>
  );
}
