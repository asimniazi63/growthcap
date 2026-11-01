import Link from "next/link";

// The Oasis Pace mark: a pace line that ends in a point, on the brand colour.
export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-mark" />
      <path d="M7 20.5c3-.2 4.2-3 6-6.5 1.6-3.1 3.3-3.8 5.2-1.8 1.4 1.5 2.6 3.2 6.8 2.4" fill="none" className="stroke-on-mark" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25" cy="13.2" r="2.2" className="fill-on-mark" />
    </svg>
  );
}

export function Brand({ href = "/chat", className = "" }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 font-display text-[1.125rem] font-semibold tracking-tight ${className}`}>
      <BrandMark />
      Oasis Pace
    </Link>
  );
}
