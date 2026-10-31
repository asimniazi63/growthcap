import { ClipboardCheck, Eye, UsersRound } from "lucide-react";

const CARDS = [
  { icon: UsersRound, title: "Growth Capital team", body: "Work across brands: pace against plan, why a month missed, and a weekly brief per brand." },
  { icon: Eye, title: "Brand viewers", body: "See one brand, read only: the chat on store data and the approved weekly briefs." },
  { icon: ClipboardCheck, title: "Every change is approved", body: "The agent proposes. A person approves. The ledger records who and when." },
];

export function Audiences() {
  return (
    <section className="bg-surface" aria-labelledby="audience-title">
      <div className="mx-auto max-w-6xl px-5 pt-2 pb-14 sm:px-8 md:pb-16 lg:px-10">
        <h2 id="audience-title" className="font-display text-[1.625rem] leading-tight font-[620] tracking-[-0.02em]">
          Built for agencies and their brands
        </h2>
        <ul role="list" className="mt-6 grid list-none gap-4 p-0 md:grid-cols-3">
          {CARDS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="card px-5 py-[1.125rem]">
              <span className="mb-3 grid size-9 place-items-center rounded-[10px] bg-brand-tint text-brand-strong">
                <Icon className="size-[1.125rem]" aria-hidden />
              </span>
              <h3 className="mb-1 font-display text-base font-[620]">{title}</h3>
              <p className="muted text-[0.9rem] leading-relaxed">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
