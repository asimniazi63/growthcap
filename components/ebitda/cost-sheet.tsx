"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { COST_CATEGORIES, type CostAssumptions, type CostCategory, type CostSheetRow } from "@/lib/ebitda/types";
import { formatUnit, monthName } from "@/lib/pace/format";

// The brand's operating costs, a month in each row and a category in each column, and the card-fee and fulfilment rates under it.
// Everyone with the brand can read it. A Growth Capital role gets inputs: each cell saves when it loses focus, with one PUT, in dollars on
// the screen and whole cents on the wire. Clearing a saved cell removes it (the PUT carries a null amount), which is how a mistaken
// edit goes back to "not entered" and lets a reload of the seed files bring its seeded value back. A cell nobody has entered says
// "not entered" (an empty input shows it as its placeholder), because a missing cost is not a $0 one. Only a month with no category
// entered at all is a ceiling on this account; a month with some of them entered is firm, and a blank category in it adds nothing.
//
// The cell inputs are uncontrolled: the browser holds what is typed, so a save that fails leaves it exactly as it was and shows the
// reason beside the cell. Each input is keyed by the amount the server holds, so once a save comes back through router.refresh() the
// cell is drawn again showing that amount. The rates are a small form with the typed values in state, and those are dropped when the
// saved rates change.

const CATEGORY_LABEL: Record<CostCategory, string> = { payroll: "Payroll", software: "Software", rent: "Rent", contractors: "Contractors", other: "Other" };

// "12.5" is 1250: a decimal with at most two places, in hundredths. The same reading serves dollars (to cents) and a percent (to basis
// points). A leading currency symbol, a trailing % and thousands separators are allowed; a minus sign, letters and a third decimal place
// are not. Returns null for anything else, so nothing but a clean amount is sent.
function toHundredths(text: string, symbol = ""): number | null {
  let t = text.trim();
  if (symbol && t.startsWith(symbol)) t = t.slice(symbol.length).trim();
  if (t.endsWith("%")) t = t.slice(0, -1).trim();
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const hundredths = Number(m[1]!.replace(/,/g, "")) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(hundredths) ? hundredths : null;
}

const plain = (cents: number) => (cents / 100).toFixed(2); // 12550 -> "125.50", as typed into an input
const percentText = (bps: number) => String(Number((bps / 100).toFixed(2))); // 290 -> "2.9", 295 -> "2.95", 300 -> "3"

const SAVE_FAILED = "That did not save. Try again.";

// One PUT to the cost route. The route's own message is shown when it sends one; a refusal for the role is said the same way every time.
async function putCost(body: object): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/ebitda/costs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return { ok: true };
    if (res.status === 403) return { ok: false, message: "Only Growth Capital roles can change the cost sheet." };
    const answer: unknown = await res.json().catch(() => null);
    const message = typeof answer === "object" && answer !== null ? (answer as { message?: unknown }).message : null;
    return { ok: false, message: typeof message === "string" && message !== "" ? message : SAVE_FAILED };
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}

interface RatesDraft {
  base: string; // the saved rates this was typed over: once those change, the typing is out of date
  percent: string;
  fixed: string;
  fulfilment: string;
}

const cellId = (month: string, category: CostCategory) => `cost-${month}-${category}`;

export function CostSheet({ months, rows, assumptions, canEdit, currency = "USD" }: { months: string[]; rows: CostSheetRow[]; assumptions: CostAssumptions; canEdit: boolean; currency?: string }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({}); // by cell id
  const [status, setStatus] = useState(""); // what the last cell save did, for a screen reader
  const [draft, setDraft] = useState<RatesDraft | null>(null);
  const [ratesNote, setRatesNote] = useState({ error: "", status: "" });

  const money = (cents: number) => formatUnit("money", cents, currency);
  const symbol = new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
  const byCell = new Map(rows.map((r) => [`${r.month}:${r.category}`, r]));

  const setError = (id: string, message: string | null) =>
    setErrors((cur) => {
      if (message === null && !(id in cur)) return cur;
      const next = { ...cur };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });

  async function saveCell(month: string, category: CostCategory, typed: string) {
    const id = cellId(month, category);
    const saved = byCell.get(`${month}:${category}`);
    const text = typed.trim();
    // A blank cell means "not entered": it removes a saved cost (a null amount), and is nothing to send when there was none. Anything
    // else has to be a clean amount, and text that is not one never removes anything.
    const amountCents = text === "" ? null : toHundredths(text, symbol);
    if (text !== "" && amountCents === null) return setError(id, "Enter an amount in dollars and cents, like 1250.00.");
    const unchanged = amountCents === null ? saved === undefined : saved?.amountCents === amountCents;
    if (unchanged) return setError(id, null);
    setError(id, null);
    const label = `${CATEGORY_LABEL[category]} for ${monthName(month)}`;
    const removing = amountCents === null;
    setStatus(`${removing ? "Clearing" : "Saving"} ${label}...`);
    const result = await putCost({ kind: "cell", month, category, amountCents });
    if (!result.ok) {
      setStatus("");
      return setError(id, result.message);
    }
    setStatus(`${removing ? "Cleared" : "Saved"} ${label}.`);
    router.refresh();
  }

  const baseKey = `${assumptions.cardFeeBps}|${assumptions.cardFeeFixedCents}|${assumptions.fulfilmentCentsPerOrder}`;
  const shown: RatesDraft = draft && draft.base === baseKey ? draft : { base: baseKey, percent: percentText(assumptions.cardFeeBps), fixed: plain(assumptions.cardFeeFixedCents), fulfilment: plain(assumptions.fulfilmentCentsPerOrder) };
  const editRate = (which: "percent" | "fixed" | "fulfilment", value: string) => setDraft({ ...shown, [which]: value });

  async function saveRates(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const cardFeeBps = toHundredths(shown.percent);
    const cardFeeFixedCents = toHundredths(shown.fixed, symbol);
    const fulfilmentCentsPerOrder = toHundredths(shown.fulfilment, symbol);
    if (cardFeeBps === null || cardFeeFixedCents === null || fulfilmentCentsPerOrder === null) {
      return setRatesNote({ error: "Enter each rate as a number, like 2.9 or 0.30.", status: "" });
    }
    setRatesNote({ error: "", status: "Saving the rates..." });
    const result = await putCost({ kind: "assumptions", cardFeeBps, cardFeeFixedCents, fulfilmentCentsPerOrder });
    if (!result.ok) return setRatesNote({ error: result.message, status: "" });
    setRatesNote({ error: "", status: "Saved the rates." });
    router.refresh();
  }

  return (
    <div>
      <div className="card overflow-x-auto">
        <table className="data-table min-w-[44rem] [&_tbody_tr:last-child_th]:border-b-0">
          <caption className="sr-only">Operating costs by month and category, in {currency}. {canEdit ? "Change an amount and move on to save it." : "Read only."}</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              {COST_CATEGORIES.map((c) => (
                <th key={c} scope="col" className="num">
                  {CATEGORY_LABEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month}>
                {/* Top-aligned like the cells, with the padding of an input above its text in edit mode, so a taller cell (an error, an "edited" tag) does not move the month. */}
                <th scope="row" className={`align-top text-[0.9rem] font-medium text-ink ${canEdit ? "pt-[1.1rem]" : "pt-[0.7rem]"}`}>
                  {monthName(month)}
                </th>
                {COST_CATEGORIES.map((category) => {
                  const saved = byCell.get(`${month}:${category}`);
                  const id = cellId(month, category);
                  const error = errors[id];
                  return (
                    <td key={category} className="num align-top">
                      {canEdit ? (
                        <>
                          <div className="relative">
                            <span aria-hidden className="faint pointer-events-none absolute inset-y-0 left-2.5 grid place-items-center text-sm">
                              {symbol}
                            </span>
                            <input
                              key={`${id}:${saved ? saved.amountCents : "none"}`}
                              id={id}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              defaultValue={saved ? plain(saved.amountCents) : undefined}
                              placeholder="not entered"
                              aria-label={`${CATEGORY_LABEL[category]}, ${monthName(month)}, in ${currency}`}
                              aria-invalid={error ? true : undefined}
                              aria-describedby={error ? `${id}-error` : undefined}
                              onBlur={(e) => saveCell(month, category, e.currentTarget.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              className="field num py-1.5 pl-6 text-right"
                            />
                          </div>
                          {error ? (
                            <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-behind">
                              {error}
                            </p>
                          ) : null}
                        </>
                      ) : saved ? (
                        money(saved.amountCents)
                      ) : (
                        <span className="faint">not entered</span>
                      )}
                      {saved?.source === "manual" ? <p className="faint mt-0.5 text-right text-[11px]">edited</p> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <p role="status" className="muted mt-2 min-h-5 text-sm">
          {status}
        </p>
      ) : (
        <p className="muted mt-2 text-sm">Only Growth Capital roles can change the cost sheet.</p>
      )}

      <div className="mt-6">
        <h3 id="cost-rates-heading" className="font-semibold">
          Card-fee and fulfilment rates
        </h3>
        <p className="muted mt-0.5 text-sm">These are assumptions, not Shopify data. They set the card-fee and fulfilment lines of every month.</p>
        {canEdit ? (
          <form onSubmit={saveRates} aria-labelledby="cost-rates-heading" className="mt-3">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="cost-rate-percent" className="block text-sm font-medium">
                  Card fee, % of net sales
                </label>
                <input id="cost-rate-percent" type="text" inputMode="decimal" autoComplete="off" value={shown.percent} onChange={(e) => editRate("percent", e.currentTarget.value)} className="field num mt-1" />
              </div>
              <div>
                <label htmlFor="cost-rate-fixed" className="block text-sm font-medium">
                  Card fee per order, {currency}
                </label>
                <input id="cost-rate-fixed" type="text" inputMode="decimal" autoComplete="off" value={shown.fixed} onChange={(e) => editRate("fixed", e.currentTarget.value)} className="field num mt-1" />
              </div>
              <div>
                <label htmlFor="cost-rate-fulfilment" className="block text-sm font-medium">
                  Fulfilment per order, {currency}
                </label>
                <input id="cost-rate-fulfilment" type="text" inputMode="decimal" autoComplete="off" value={shown.fulfilment} onChange={(e) => editRate("fulfilment", e.currentTarget.value)} className="field num mt-1" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <button type="submit" className="btn btn-secondary btn-sm">
                Save rates
              </button>
              {ratesNote.error ? (
                <p role="alert" className="text-sm text-behind">
                  {ratesNote.error}
                </p>
              ) : null}
              <p role="status" className="muted text-sm">
                {ratesNote.status}
              </p>
            </div>
          </form>
        ) : (
          <p className="num mt-2 text-sm">
            Card fees: {percentText(assumptions.cardFeeBps)}% of net sales plus {money(assumptions.cardFeeFixedCents)} per order. Fulfilment: {money(assumptions.fulfilmentCentsPerOrder)} per order.
          </p>
        )}
      </div>
    </div>
  );
}
