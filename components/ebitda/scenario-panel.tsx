"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import type { CostAssumptions } from "@/lib/ebitda/types";
import { DEFAULT_PRICE_ELASTICITY, runScenario, volumeChangeForTarget, type Levers, type ScenarioBase } from "@/lib/metrics/ebitda";
import { formatUnit } from "@/lib/pace/format";

// What-if levers over the last few complete months: five sliders, the price elasticity (an assumption, labelled as one) and a target
// EBITDA per month. Every figure comes from runScenario and volumeChangeForTarget, the same engine the chat's scenario tool runs, so the
// page and the chat agree. The sliders move in whole percent; the engine takes fractions.
//
// `base` is the months added together (scenarioBaseOf) and `months` is how many were added, so the table can show a month at a time as
// well as the whole period. `baselineIsCeiling` is for a base that includes months with missing costs, whose EBITDA is no higher than
// shown, with or without the changes.

type LeverKey = "priceChange" | "adSpendChange" | "unitCostChange" | "volumeChange" | "operatingCostChange";

// The ranges are narrower than the chat tool accepts, so a slider stays easy to place.
const LEVERS: { key: LeverKey; label: string; min: number; max: number; hint: string }[] = [
  { key: "priceChange", label: "Price", min: -50, max: 50, hint: "The selling price. Orders respond to it through the elasticity below." },
  { key: "adSpendChange", label: "Ad spend", min: -100, max: 100, hint: "What you spend on ads. New-customer orders move with it." },
  { key: "unitCostChange", label: "Unit cost", min: -50, max: 50, hint: "What each unit costs to buy or make." },
  { key: "volumeChange", label: "Order volume", min: -50, max: 100, hint: "More or fewer orders for any other reason: demand, a launch, the season." },
  { key: "operatingCostChange", label: "Operating costs", min: -100, max: 100, hint: "Everything on the cost sheet: payroll, software, rent, contractors and the rest." },
];
const ZERO: Record<LeverKey, number> = { priceChange: 0, adSpendChange: 0, unitCostChange: 0, volumeChange: 0, operatingCostChange: 0 };

const ELASTICITY_MIN = -5; // the chat tool's limit too
const MINUS = "−"; // a real minus sign, which is wider than a hyphen and cannot be read as a dash

const signedPct = (percent: number) => (percent === 0 ? "0%" : `${percent < 0 ? MINUS : "+"}${Math.abs(percent)}%`);
const withMinus = (n: number) => (n < 0 ? `${MINUS}${Math.abs(n)}` : String(n));
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// A plain number, minus sign and decimals allowed, within the range the chat tool takes. Anything else is null: "1e3" and "Infinity" are not
// something a person meant as an elasticity.
function parseElasticity(text: string): number | null {
  const t = text.trim().replace(MINUS, "-");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return v >= ELASTICITY_MIN && v <= 0 ? v + 0 : null;
}

// Dollars to whole cents, "1,500", "$1,500.50" or "-500", with at most two decimals. A target can be a loss, so a minus sign is allowed.
function toCents(text: string, symbol: string): number | null {
  let t = text.trim();
  const negative = t.startsWith("-") || t.startsWith(MINUS);
  if (negative) t = t.slice(1).trim();
  if (t.startsWith(symbol)) t = t.slice(symbol.length).trim();
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1]!.replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? (negative ? -cents : cents) + 0 : null;
}

export function ScenarioPanel({
  base,
  assumptions,
  months,
  currency = "USD",
  baselineIsCeiling = false,
}: {
  base: ScenarioBase;
  assumptions: CostAssumptions;
  months: number;
  currency?: string;
  baselineIsCeiling?: boolean;
}) {
  const [percent, setPercent] = useState<Record<LeverKey, number>>(ZERO); // whole percent, by lever
  const [elasticityText, setElasticityText] = useState(String(DEFAULT_PRICE_ELASTICITY));
  const [targetText, setTargetText] = useState("");

  const n = Number.isFinite(months) && months >= 1 ? Math.round(months) : 1;
  const money = (cents: number) => formatUnit("money", cents === 0 ? 0 : cents, currency);
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  const each = (cents: number) => Math.round(cents / n) + 0; // a month at a time

  // A lever at zero is left out, so the engine sees only what has been changed. An elasticity that is not a number falls back to the default.
  const elasticity = parseElasticity(elasticityText);
  const levers: Levers = { elasticity: elasticity ?? DEFAULT_PRICE_ELASTICITY };
  for (const { key } of LEVERS) if (percent[key] !== 0) levers[key] = percent[key] / 100;
  const result = runScenario(base, assumptions, levers);

  const baselineMonthly = each(result.baseline.ebitdaCents);
  const scenarioMonthly = each(result.scenario.ebitdaCents);
  const monthlyDelta = scenarioMonthly - baselineMonthly;
  const delta = result.deltaEbitdaCents;
  const words = (cents: number) => (cents === 0 ? "no change" : `${cents > 0 ? "up" : "down"} ${money(Math.abs(cents))}`);
  const tone = (cents: number) => (cents > 0 ? "text-ahead" : cents < 0 ? "text-behind" : "");
  const said = [monthlyDelta !== 0 ? `${words(monthlyDelta)} a month` : null, n > 1 && delta !== 0 ? `${words(delta)} over the ${n} months` : null].filter(Boolean);
  const summary = said.length === 0 ? "With these settings EBITDA would not change." : `With these changes EBITDA would be ${said.join(", or ")}.`;

  const targetCents = toCents(targetText, symbol);
  let answer = "Type the EBITDA you want each month to see how many orders it would take.";
  if (targetText.trim() !== "") {
    if (targetCents === null) {
      answer = "Enter the target in dollars, like 5000.";
    } else {
      // The target is a month's; the engine works on the whole base, which is n months.
      const found = volumeChangeForTarget(base, assumptions, levers, targetCents * n);
      if (found === null) {
        answer = "Changing order volume alone cannot reach that with these settings.";
      } else if (Math.abs(found.volumeChange) < 0.0005) {
        answer = `These settings already reach ${money(targetCents)} a month: no change in order volume is needed.`;
      } else {
        const change = `${found.volumeChange < 0 ? MINUS : "+"}${Math.abs(found.volumeChange * 100).toFixed(1)}%`;
        answer = `To reach ${money(targetCents)} a month, set Order volume to about ${change}: roughly ${count.format(each(found.ordersNeeded))} orders a month instead of ${count.format(each(base.orders))}.`;
      }
    }
  }

  const reset = () => {
    setPercent(ZERO);
    setElasticityText(String(DEFAULT_PRICE_ELASTICITY));
    setTargetText("");
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      {/* The result comes first in the page, so it is in view on a phone while a slider is moved, and beside the controls on a wide screen. */}
      <div className="inset p-4 xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:self-start">
        <p role="status" className="sr-only">
          {summary}
        </p>
        <table className="data-table [&_tbody_tr:last-child_th]:border-b-0">
          <caption className="sr-only">EBITDA with and without your changes</caption>
          <thead>
            <tr>
              <th scope="col">EBITDA</th>
              <th scope="col" className="num">
                A month
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className="align-top font-normal text-ink">
                Baseline
              </th>
              <td className="num">
                {money(baselineMonthly)}
                {n > 1 ? <span className="faint block text-xs">{`${money(result.baseline.ebitdaCents)} over ${n} months`}</span> : null}
              </td>
            </tr>
            <tr>
              <th scope="row" className="align-top font-normal text-ink">
                With your changes
              </th>
              <td className="num">
                {money(scenarioMonthly)}
                {n > 1 ? <span className="faint block text-xs">{`${money(result.scenario.ebitdaCents)} over ${n} months`}</span> : null}
              </td>
            </tr>
            <tr>
              <th scope="row" className="align-top font-semibold text-ink">
                Change
              </th>
              <td className={`num font-semibold ${tone(monthlyDelta)}`}>
                {words(monthlyDelta)}
                {n > 1 && delta !== 0 ? <span className={`block text-xs font-normal ${tone(delta)}`}>{`${words(delta)} over ${n} months`}</span> : null}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="faint mt-3 text-xs">{n > 1 ? `Based on the last ${n} complete months, shown a month at a time and over the ${n} months.` : "Based on the last complete month."}</p>
        {baselineIsCeiling ? (
          <p className="mt-2 text-sm text-warn">The baseline is a ceiling: some costs are missing from the months it rests on, so EBITDA, with or without your changes, is no higher than shown.</p>
        ) : null}
      </div>

      <div className="space-y-6 xl:col-start-1 xl:row-start-1">
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {LEVERS.map((l) => (
            <div key={l.key}>
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={`scenario-${l.key}`} className="text-sm font-medium">
                  {l.label}
                </label>
                <span aria-hidden className="num text-sm font-semibold">
                  {signedPct(percent[l.key])}
                </span>
              </div>
              <input
                id={`scenario-${l.key}`}
                type="range"
                min={l.min}
                max={l.max}
                step={1}
                value={percent[l.key]}
                aria-valuetext={signedPct(percent[l.key])}
                onChange={(e) => {
                  const v = Number(e.currentTarget.value);
                  setPercent({ ...percent, [l.key]: Number.isFinite(v) ? Math.min(l.max, Math.max(l.min, v)) : 0 });
                }}
                className="mt-1 w-full accent-brand"
              />
              <p className="faint text-xs">{l.hint}</p>
            </div>
          ))}
        </div>

        <div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <label htmlFor="scenario-elasticity" className="text-sm font-medium">
              Price elasticity
            </label>
            <span id="scenario-elasticity-note" className="faint text-xs">
              {`assumption (default ${withMinus(DEFAULT_PRICE_ELASTICITY)})`}
            </span>
          </div>
          <input
            id="scenario-elasticity"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={elasticityText}
            aria-describedby="scenario-elasticity-note"
            onChange={(e) => setElasticityText(e.currentTarget.value)}
            className="field num mt-1 max-w-32"
          />
          <p className="faint mt-1 text-xs">How far orders fall when the price rises. It is a guess, not something measured.</p>
          {elasticity === null ? <p className="mt-1 text-xs text-warn">{`Using the default ${withMinus(DEFAULT_PRICE_ELASTICITY)} until this is a number from ${MINUS}5 to 0.`}</p> : null}
        </div>

        <div>
          <label htmlFor="scenario-target" className="text-sm font-medium">
            Target EBITDA per month
          </label>
          <div className="relative mt-1 max-w-48">
            <span aria-hidden className="faint pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-sm">
              {symbol}
            </span>
            <input
              id="scenario-target"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 5000"
              value={targetText}
              aria-describedby="scenario-target-answer"
              onChange={(e) => setTargetText(e.currentTarget.value)}
              className="field num pl-7"
            />
          </div>
          <p id="scenario-target-answer" className="muted mt-1.5 text-sm">
            {answer}
          </p>
        </div>

        <div>
          <button type="button" onClick={reset} className="btn btn-secondary btn-sm">
            <RotateCcw className="size-3.5" aria-hidden />
            Reset
          </button>
        </div>

        <p className="muted max-w-[62ch] text-sm">
          Ad spend works like this here: changing it by a percentage changes new-customer orders by the same percentage, at today&apos;s cost per new customer, and leaves returning-customer
          orders alone. That is an assumption, not something measured.
        </p>
      </div>
    </div>
  );
}
