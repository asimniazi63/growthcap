import Link from "next/link";
import { ShieldCheck } from "lucide-react";

// What the product is, in one sentence, next to an example of the answer it gives.
export function LandingHero() {
  return (
    <section className="bg-paper" aria-labelledby="landing-title">
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-5 py-12 sm:px-8 md:py-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-14 lg:px-10 lg:py-20">
        <div>
          <h1 id="landing-title" className="max-w-[14ch] font-display text-[length:clamp(2.125rem,5.2vw,3.375rem)] leading-[1.04] font-[650] tracking-[-0.03em]">
            Ask about a store. Get numbers you can check.
          </h1>
          <p className="mt-5 mb-7 max-w-[46ch] text-lg leading-relaxed text-ink-2">
            Oasis Pace answers questions about a Shopify store&apos;s sales, orders, stock and customers. Every figure in an answer is matched to a query result before you see it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/sign-in" className="btn btn-primary px-5 py-[0.7rem] text-[0.9375rem]">
              Sign in
            </Link>
            <a href="#how-it-works" className="btn btn-secondary px-5 py-[0.7rem] text-[0.9375rem]">
              See how a figure is checked
            </a>
          </div>
        </div>

        <figure className="m-0 min-w-0">
          <div className="card p-5 shadow-pop sm:px-6 sm:py-5 lg:-rotate-[0.6deg]">
            <div className="mb-4 flex justify-end">
              <p className="max-w-[85%] rounded-[18px] bg-inverse px-[1.125rem] py-[0.6875rem] text-on-inverse">How are we pacing this month?</p>
            </div>
            <p className="leading-[1.75]">
              Net sales are <span className="verified-figure cursor-default">$1,018.60</span>, ahead of plan by <span className="verified-figure cursor-default">$75.44</span>. On this pace the month lands at about{" "}
              <span className="verified-figure cursor-default">$1,052.55</span> (an estimate).
            </p>
            <p className="mt-3 flex items-center gap-[0.45rem] text-[0.78rem] text-ink-3">
              <ShieldCheck className="size-3.5 shrink-0 text-brand-strong" aria-hidden />
              Every number here was checked against the store data.
            </p>
          </div>
          <figcaption className="faint mt-3 text-center text-[0.8125rem]">An example answer from a demo store</figcaption>
        </figure>
      </div>
    </section>
  );
}
