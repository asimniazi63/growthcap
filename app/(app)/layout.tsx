import { auth } from "@clerk/nextjs/server";
import { OrganizationList, OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { Brand } from "@/components/shell/brand";
import { Nav } from "@/components/shell/nav";

const switcher = {
  elements: {
    rootBox: "w-full",
    organizationSwitcherTrigger: "w-full justify-between rounded-[10px] border border-line bg-surface px-3 py-2 shadow-card",
  },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = await auth();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-6 border-r border-line bg-surface/50 px-4 py-5 lg:flex">
        <Brand className="px-2" />
        <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/connect" appearance={switcher} />
        <Nav variant="side" />
        <div className="border-t border-line pt-4">
          <UserButton showName appearance={{ elements: { rootBox: "w-full", userButtonTrigger: "w-full justify-start rounded-[10px] px-2 py-1.5" } }} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <Brand />
            <div className="flex items-center gap-2">
              <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/connect" />
              <UserButton />
            </div>
          </div>
          <Nav variant="top" />
        </header>

        <main className="mx-auto w-full max-w-[1120px] px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
          {orgId ? (
            children
          ) : (
            <div className="card card-pad mx-auto mt-6 flex max-w-lg flex-col items-center gap-4 py-10 text-center">
              <h1 className="page-title">Choose a brand</h1>
              <p className="muted">Pick the brand you want to work on. Each brand sees only its own store.</p>
              <OrganizationList hidePersonal afterSelectOrganizationUrl="/connect" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
