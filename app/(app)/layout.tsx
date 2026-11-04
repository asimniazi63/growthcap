import { auth } from "@clerk/nextjs/server";
import { OrganizationList, OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { Brand } from "@/components/shell/brand";
import { CommandPalette, PaletteButton } from "@/components/shell/command-palette";
import { Nav } from "@/components/shell/nav";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { TopBar } from "@/components/shell/top-bar";
import { ToastProvider } from "@/components/ui/toast";
import { listActions } from "@/lib/actions/ledger";
import { getDb } from "@/lib/db/client";
import { canViewTeam } from "@/lib/team/team";
import { getTenantContext } from "@/lib/tenancy/context";

const switcher = {
  elements: {
    rootBox: "w-full",
    organizationSwitcherTrigger: "w-full justify-between rounded-[10px] border border-line bg-surface px-3 py-2 shadow-card",
  },
};

// The switcher in the mobile bar has no background of its own, so its icon follows the bar (navy in the Sorbet scheme). Its name takes
// the rail colour from app/globals.css, scoped to the button so the rows in its dropdown keep the card's text colour.
const mobileSwitcher = {
  elements: {
    organizationSwitcherTriggerIcon: "text-on-rail-2",
  },
};

// What the shell needs from the signed-in brand: whether the person is Growth Capital staff, whether they are a Growth Capital admin
// (who also gets the Team link), and how many proposed changes wait for a decision (the count on Actions). A failure here must never
// break a page, so it falls back to "none".
async function shellState(): Promise<{ gc: boolean; admin: boolean; pending: number }> {
  try {
    const ctx = await getTenantContext();
    const gc = ctx.role === "gc_admin" || ctx.role === "gc_partner";
    const admin = canViewTeam(ctx);
    if (!gc) return { gc, admin, pending: 0 };
    return { gc, admin, pending: (await listActions(getDb(), ctx, { status: "proposed" })).length };
  } catch {
    return { gc: false, admin: false, pending: 0 };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = await auth();
  const { gc, admin, pending } = orgId ? await shellState() : { gc: false, admin: false, pending: 0 };

  return (
    <ToastProvider>
      <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="app-rail sticky top-0 hidden h-screen flex-col gap-5 border-r border-line bg-rail px-4 py-5 lg:flex">
          <Brand href="/overview" className="px-2 text-on-rail" />
          <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/overview" appearance={switcher} />
          <div className="side-palette">
            <PaletteButton />
          </div>
          <Nav variant="side" gc={gc} admin={admin} pending={pending} />
          <div className="rail-me flex items-center gap-1 border-t border-line pt-4">
            <div className="min-w-0 flex-1">
              <UserButton showName appearance={{ elements: { rootBox: "w-full", userButtonTrigger: "w-full justify-start rounded-[10px] px-2 py-1.5", userButtonOuterIdentifier: "text-on-rail" } }} />
            </div>
            <ThemeToggle className="text-on-rail-2 hover:text-on-rail" />
          </div>
        </aside>

        <div className="min-w-0">
          <header className="app-mobilebar sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <Brand href="/overview" className="text-on-rail" />
              <div className="flex items-center gap-2">
                <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/overview" appearance={mobileSwitcher} />
                <ThemeToggle className="text-on-rail-2 hover:text-on-rail" />
                <UserButton />
              </div>
            </div>
            <Nav variant="top" gc={gc} admin={admin} pending={pending} />
          </header>

          <TopBar />

          {/* Pages are held to 1120px for reading. A page that wants the whole width (the Chat) puts data-wide-page on its root, and the cap lifts. */}
          <main className="mx-auto w-full max-w-[1120px] px-5 py-8 has-[[data-wide-page]]:max-w-none sm:px-8 lg:px-12 lg:py-10">
            {orgId ? (
              children
            ) : (
              <div className="card card-pad mx-auto mt-6 flex max-w-lg flex-col items-center gap-4 py-10 text-center">
                <h1 className="page-title">Choose a brand</h1>
                <p className="muted">Pick the brand you want to work on. Each brand sees only its own store.</p>
                <OrganizationList hidePersonal afterSelectOrganizationUrl="/overview" />
              </div>
            )}
          </main>
        </div>
      </div>
      <CommandPalette gc={gc} admin={admin} />
    </ToastProvider>
  );
}
