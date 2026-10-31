// The four-step path a number takes from the store to the screen. It is a real sequence, so the steps are numbered.
const STEPS = [
  { title: "The agent asks a typed question", body: "It never writes SQL and never does arithmetic. Each tool answers one family of questions for one brand." },
  { title: "The tool returns figures", body: "Each result carries its metric definitions and a query id." },
  { title: "A checker reads the answer", body: "It rejects any number that is not in that turn's results, and the agent gets one chance to fix it." },
  { title: "You see what could not be sourced", body: "Anything left over is flagged on screen, not hidden." },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-4 bg-surface" aria-labelledby="how-title">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8 md:py-14 lg:px-10">
        <h2 id="how-title" className="font-display text-[1.625rem] leading-tight font-[620] tracking-[-0.02em]">
          How a figure gets checked
        </h2>
        <ol role="list" className="mt-7 grid list-none gap-x-5 gap-y-8 p-0 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="border-t-2 border-ink pt-3.5">
              <span className="num mb-2 block font-display text-sm font-[650] text-brand-strong" aria-hidden>
                {i + 1}
              </span>
              <h3 className="mb-1 font-display text-[1.0625rem] leading-snug font-[620]">{step.title}</h3>
              <p className="muted text-[0.9rem] leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
