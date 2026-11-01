"use client";

import { Check, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { DEFAULT_APPEARANCE, MODE_LABEL, MODE_PREFS, SCHEME_IDS, SCHEME_INFO, type Appearance, type ModePref, type SchemeId } from "@/lib/appearance/schemes";
import { useAppearance } from "@/lib/appearance/use-appearance";
import { SchemeThumb } from "./scheme-thumb";

const MODE_ICON: Record<ModePref, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

// The ids are fixed because the form appears once on the page. The groups are real radios, so the arrow keys, Tab and Space work as they do everywhere.
const SCHEME_HEADING = "appearance-scheme-heading";
const MODE_HEADING = "appearance-mode-heading";
const KEEP_HEADING = "appearance-keep-heading";

const block = "grid gap-4 border-t border-line pt-7 lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-x-12";
const focusRing = "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-[3px] has-[input:focus-visible]:outline-brand";

function Heading({ id, title, children }: { id: string; title: string; children: string }) {
  return (
    <div>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      <p className="mt-1.5 max-w-[30ch] text-sm text-ink-2">{children}</p>
    </div>
  );
}

export function AppearanceForm({ initial }: { initial?: Appearance } = {}) {
  const { scheme, pref, mode, setScheme, setMode, reset } = useAppearance(initial);
  const toast = useToast();

  const chooseScheme = (next: SchemeId) => {
    setScheme(next);
    toast.show("Appearance saved in this browser.");
  };
  const chooseMode = (next: ModePref) => {
    setMode(next);
    toast.show("Appearance saved in this browser.");
  };
  const resetAll = () => {
    reset();
    toast.show("Back to the default.");
  };

  return (
    <div className="flex flex-col gap-9">
      <section aria-labelledby={SCHEME_HEADING} className={block}>
        <Heading id={SCHEME_HEADING} title="Colour scheme">
          Applies as soon as you pick one. It also colours the sign-in and landing pages in this browser.
        </Heading>
        <div role="radiogroup" aria-labelledby={SCHEME_HEADING} className="grid grid-cols-[repeat(auto-fill,minmax(215px,1fr))] gap-4">
          {SCHEME_IDS.map((id) => {
            const selected = scheme === id;
            const { name, description } = SCHEME_INFO[id];
            return (
              <label key={id} className={`relative block cursor-pointer rounded-2xl border border-line-strong bg-surface p-2.5 pb-3.5 transition-[border-color,box-shadow] hover:border-ink-3 has-[input:checked]:border-brand has-[input:checked]:ring-2 has-[input:checked]:ring-brand ${focusRing}`}>
                <SchemeThumb scheme={id} mode={mode} />
                <span className="mx-1 mb-0.5 mt-3 flex items-center gap-2 font-semibold">
                  {name}
                  {id === DEFAULT_APPEARANCE.scheme ? <span className="badge badge-brand">Default</span> : null}
                  {selected ? (
                    <span className="ml-auto grid size-5 place-items-center rounded-full bg-brand text-on-brand">
                      <Check className="size-3" strokeWidth={3.4} aria-hidden />
                    </span>
                  ) : null}
                </span>
                <span id={`scheme-desc-${id}`} className="mx-1 block text-[0.84rem] leading-snug text-ink-2">
                  {description}
                </span>
                <input type="radio" name="scheme" value={id} checked={selected} onChange={() => chooseScheme(id)} aria-label={name} aria-describedby={`scheme-desc-${id}`} className="absolute inset-0 m-0 cursor-pointer opacity-0" />
              </label>
            );
          })}
        </div>
      </section>

      <section aria-labelledby={MODE_HEADING} className={block}>
        <Heading id={MODE_HEADING} title="Light or dark">
          Every scheme comes in both. Match my device follows your system setting.
        </Heading>
        <div role="radiogroup" aria-labelledby={MODE_HEADING} className="inline-flex gap-0.5 self-start justify-self-start rounded-full border border-line-strong bg-surface p-1">
          {MODE_PREFS.map((value) => {
            const Icon = MODE_ICON[value];
            return (
              <label key={value} className={`relative inline-flex cursor-pointer items-center gap-2 rounded-full px-[18px] py-2 text-[0.9rem] font-medium text-ink-2 has-[input:checked]:bg-brand has-[input:checked]:text-on-brand ${focusRing}`}>
                <Icon className="size-4" aria-hidden />
                {MODE_LABEL[value]}
                <input type="radio" name="mode" value={value} checked={pref === value} onChange={() => chooseMode(value)} className="absolute inset-0 m-0 cursor-pointer opacity-0" />
              </label>
            );
          })}
        </div>
      </section>

      <section aria-labelledby={KEEP_HEADING} className={block}>
        <Heading id={KEEP_HEADING} title="Where it is kept">
          Saved in this browser, so every page opens in your scheme with no flash. It does not follow you to other browsers.
        </Heading>
        <div className="flex flex-col items-start gap-4">
          <button type="button" className="btn btn-secondary btn-sm" onClick={resetAll}>
            Reset to default
          </button>
        </div>
      </section>
    </div>
  );
}
