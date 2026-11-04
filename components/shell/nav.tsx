"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenCheck, Calculator, FileText, Gauge, LayoutDashboard, LayoutGrid, ListChecks, MessagesSquare, Newspaper, Plug, ScanSearch, Settings, UserCog, UsersRound, type LucideIcon } from "lucide-react";
import { GC_ONLY_PAGES } from "./pages";

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
      { href: "/playbooks", label: "Playbooks", icon: BookOpenCheck },
      { href: "/segments", label: "Segments", icon: UsersRound },
      { href: "/ebitda", label: "EBITDA", icon: Calculator },
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
const TEAM: Item = { href: "/team", label: "Team", icon: UserCog };
const SETTINGS: Item = { href: "/settings", label: "Settings", icon: Settings };

// The links at the foot of the sidebar (and the end of the mobile bar). Connect and Settings are for everyone; Team, who is on the
// brand and the role each holds, sits above Settings and is only offered to a Growth Capital admin.
export function footerItems(admin: boolean): Item[] {
  return admin ? [CONNECT, TEAM, SETTINGS] : [CONNECT, SETTINGS];
}

// The groups a person sees: the pages that are Growth Capital's alone are left out for everyone else, and a group with nothing
// left goes too.
export function navGroups(gc: boolean): { label: string; items: Item[] }[] {
  return GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => gc || !GC_ONLY_PAGES.includes(i.href)) })).filter((g) => g.items.length > 0);
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function SideLink({ item, pathname, pending = 0 }: { item: Item; pathname: string; pending?: number }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-rail-active text-on-rail shadow-card ring-1 ring-line" : "text-on-rail-2 hover:bg-paper-2 hover:text-on-rail"
      }`}
    >
      <Icon className={`size-[1.125rem] ${active ? "text-brand" : "text-on-rail-3"}`} aria-hidden />
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

export function Nav({ variant, gc, admin = false, pending = 0 }: { variant: "side" | "top"; gc: boolean; admin?: boolean; pending?: number }) {
  const pathname = usePathname() ?? "";
  const groups = navGroups(gc);
  const footer = footerItems(admin);

  if (variant === "top") {
    return (
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-4 pb-2.5 [scrollbar-width:none] lg:hidden">
        {[...groups.flatMap((g) => g.items), ...footer].map((item) => (
          <TopLink key={item.href} item={item} pathname={pathname} pending={pending} />
        ))}
      </nav>
    );
  }

  // The rail is one screen tall and sticks, so on a short window (or a zoomed-in browser) the links scroll inside it, and the brand
  // switcher above and the account row below stay in view. -m-1 p-1 leaves room for the focus ring, which the scroll box would clip.
  return (
    <nav aria-label="Main" className="-m-1 flex min-h-0 flex-1 flex-col overflow-y-auto p-1 [scrollbar-width:thin]">
      {groups.map((g) => (
        <div key={g.label} className="mb-5">
          {g.label ? <p className="px-3 pb-1.5 text-xs font-medium text-on-rail-3">{g.label}</p> : null}
          <ul className="space-y-0.5">
            {g.items.map((item) => (
              <li key={item.href}>
                <SideLink item={item} pathname={pathname} pending={pending} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <ul className="mt-auto space-y-0.5">
        {footer.map((item) => (
          <li key={item.href}>
            <SideLink item={item} pathname={pathname} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
