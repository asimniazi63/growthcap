import Link from "next/link";

// The closing band: dark, one line and one way in.
export function LandingFooter() {
  return (
    <footer className="bg-ink text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-7 sm:px-8 lg:px-10">
        <p className="font-display text-xl font-[620]">See your own numbers.</p>
        <Link href="/sign-in" className="btn btn-secondary focus-visible:outline-white">
          Sign in
        </Link>
      </div>
    </footer>
  );
}
