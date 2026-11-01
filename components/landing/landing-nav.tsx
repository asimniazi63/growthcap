import Link from "next/link";
import { Brand } from "@/components/shell/brand";
import { ThemeToggle } from "@/components/shell/theme-toggle";

// The top bar of the public landing page: the brand on the left, one way in on the right.
export function LandingNav() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-10">
        <Brand href="/" />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/sign-in" className="btn btn-primary">
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}
