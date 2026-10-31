import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { OrganizationList, OrganizationSwitcher, UserButton } from "@clerk/nextjs";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { orgId } = await auth();

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-200 py-4">
        <div className="flex items-center gap-6">
          <Link href="/connect" className="text-lg font-semibold tracking-tight">
            Oasis Pace
          </Link>
          <nav className="flex gap-4 text-sm text-neutral-600">
            <Link href="/chat" className="hover:text-neutral-900">
              Chat
            </Link>
            <Link href="/pace" className="hover:text-neutral-900">
              Pace
            </Link>
            <Link href="/plan" className="hover:text-neutral-900">
              Plan
            </Link>
            <Link href="/actions" className="hover:text-neutral-900">
              Actions
            </Link>
            <Link href="/portfolio" className="hover:text-neutral-900">
              Portfolio
            </Link>
            <Link href="/briefs" className="hover:text-neutral-900">
              Briefs
            </Link>
            <Link href="/connect" className="hover:text-neutral-900">
              Connect
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/connect" />
          <UserButton />
        </div>
      </header>
      <main className="pt-8">
        {orgId ? (
          children
        ) : (
          <div className="flex flex-col items-center gap-4">
            <p className="text-neutral-600">Choose a brand to continue.</p>
            <OrganizationList hidePersonal afterSelectOrganizationUrl="/connect" />
          </div>
        )}
      </main>
    </div>
  );
}
