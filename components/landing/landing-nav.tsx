import Link from "next/link";
import { Brand } from "@/components/shell/brand";

// The top bar of the public landing page: the brand on the left, one way in on the right.
export function LandingNav() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-10">
        <Brand href="/" />
        <Link href="/sign-in" className="btn btn-primary">
          Sign in
        </Link>
      </div>
    </header>
  );
}
