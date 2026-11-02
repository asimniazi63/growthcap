import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CostAssumptions, CostSheetRow } from "@/lib/ebitda/types";
import { CostSheet } from "./cost-sheet";

// The repo has no browser-like DOM for tests, so this runs in plain Node, as components/settings/appearance-form.test.tsx does. useState is
// replaced by a small store that keeps its values from one render to the next, the router is a spy and fetch is a stub. The real sheet
// runs unchanged: a test reads the element tree it returns to find a handler, calls it with a stand-in event, waits for it, and renders
// again to see what a person would see. The sheet keeps all its state in its own top-level useState calls, which is what makes this work.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const i = hooks.cursor++;
      if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === "function" ? (initial as () => T)() : initial;
      const set = (next: T | ((cur: T) => T)) => {
        hooks.slots[i] = typeof next === "function" ? (next as (cur: T) => T)(hooks.slots[i] as T) : next;
      };
      return [hooks.slots[i] as T, set] as const;
    },
  };
});

const fetchMock = vi.fn();
const answer = (status: number, body: unknown = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

beforeEach(() => {
  hooks.slots = [];
  refresh.mockReset();
  fetchMock.mockReset().mockResolvedValue(answer(200, { ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

const MONTHS = ["2026-08", "2026-09", "2026-10"];
// August and September have some categories; October has none at all.
const ROWS: CostSheetRow[] = [
  { month: "2026-08", category: "software", amountCents: 12_000, source: "fixture" },
  { month: "2026-08", category: "contractors", amountCents: 60_000, source: "fixture" },
  { month: "2026-09", category: "software", amountCents: 12_500, source: "manual" },
  { month: "2026-09", category: "other", amountCents: 90_000, source: "fixture" },
];
const ASSUMPTIONS: CostAssumptions = { cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 };

type Props = Parameters<typeof CostSheet>[0];
const props = (over: Partial<Props> = {}): Props => ({ months: MONTHS, rows: ROWS, assumptions: ASSUMPTIONS, canEdit: true, ...over });
const html = (over: Partial<Props> = {}) => {
  hooks.cursor = 0;
  return renderToStaticMarkup(<CostSheet {...props(over)} />);
};
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

type ElementProps = { [key: string]: unknown; children?: ReactNode };
function elements(node: ReactNode, found: ReactElement<ElementProps>[] = []): ReactElement<ElementProps>[] {
  if (Array.isArray(node)) {
    node.forEach((n) => elements(n, found));
  } else if (isValidElement<ElementProps>(node)) {
    found.push(node);
    elements(node.props.children, found);
  }
  return found;
}
const tree = (over: Partial<Props> = {}) => {
  hooks.cursor = 0;
  return elements(CostSheet(props(over)));
};
const input = (label: string, over: Partial<Props> = {}) => {
  const found = tree(over).find((e) => e.type === "input" && e.props["aria-label"] === label);
  if (!found) throw new Error(`no input labelled ${label}`);
  return found;
};
const RATE_IDS = { percent: "cost-rate-percent", fixed: "cost-rate-fixed", fulfilment: "cost-rate-fulfilment" } as const;
const rate = (which: keyof typeof RATE_IDS) => {
  const found = tree().find((e) => e.type === "input" && e.props.id === RATE_IDS[which]);
  if (!found) throw new Error(`no rate field ${which}`);
  return found;
};
const blur = (el: ReactElement<ElementProps>, value: string) => (el.props.onBlur as (e: unknown) => Promise<void>)({ currentTarget: { value } });
const typeInto = (el: ReactElement<ElementProps>, value: string) => (el.props.onChange as (e: unknown) => void)({ currentTarget: { value } });
const submitRates = () => {
  const form = tree().find((e) => e.type === "form")!;
  return (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => undefined });
};
const SOFTWARE_AUG = "Software, August 2026, in USD";
const SOFTWARE_OCT = "Software, October 2026, in USD";

describe("CostSheet for someone who can only look", () => {
  it("shows the amounts as text and draws no input, form or button", () => {
    const out = html({ canEdit: false });
    expect(out).not.toMatch(/<input|<form|<button|<textarea/);
    expect(text(out)).toContain("$120.00");
    expect(text(out)).toContain("$600.00");
    expect(text(out)).toContain("$125.00");
    expect(text(out)).toContain("$900.00");
    expect(text(out)).toContain("Only Growth Capital roles can change the cost sheet.");
  });

  it("shows a missing cell as 'not entered', never as $0.00", () => {
    const out = html({ canEdit: false });
    // 15 cells, 4 of them entered
    expect(out.match(/not entered/g)).toHaveLength(11);
    expect(out).not.toContain("$0.00");
    // An empty month is five of them in a row.
    const october = /<tr[^>]*><th[^>]*>October 2026<\/th>[\s\S]*?<\/tr>/.exec(out)![0];
    expect(october.match(/not entered/g)).toHaveLength(5);
    expect(text(october)).not.toMatch(/\$/);
  });

  it("shows an amount that was entered as zero as $0.00, which is not the same thing", () => {
    const out = html({ canEdit: false, rows: [{ month: "2026-10", category: "rent", amountCents: 0, source: "manual" }] });
    expect(text(/<tr[^>]*><th[^>]*>October 2026<\/th>[\s\S]*?<\/tr>/.exec(out)![0])).toContain("$0.00");
  });

  it("has a column for each category and a row for each month, in the order given", () => {
    const out = html({ canEdit: false });
    expect(text(/<thead>[\s\S]*<\/thead>/.exec(out)![0])).toBe("Month Payroll Software Rent Contractors Other");
    expect([...out.matchAll(/<th scope="row"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(["August 2026", "September 2026", "October 2026"]);
  });

  it("marks the cells a person typed in, and only those", () => {
    const out = html({ canEdit: false });
    expect(out.match(/>edited</g)).toHaveLength(1);
  });

  it("states the card-fee and fulfilment rates in words", () => {
    const out = text(html({ canEdit: false }));
    expect(out).toContain("2.9% of net sales plus $0.30 per order");
    expect(out).toContain("$4.50 per order");
  });
});

describe("CostSheet for a Growth Capital role", () => {
  it("draws an input for every cell and every rate, each with a label, and a button to save the rates", () => {
    const out = html();
    expect(out.match(/<input /g)).toHaveLength(15 + 3);
    expect(out).toContain(`aria-label="${SOFTWARE_AUG}"`);
    expect(out).toMatch(/<button[^>]*type="submit"[^>]*>Save rates<\/button>/);
    expect(out).not.toContain("Only Growth Capital roles can change the cost sheet.");
  });

  it("fills an input with its saved amount in dollars, and leaves a missing one empty with 'not entered' in it", () => {
    const out = html();
    expect(/<input [^>]*aria-label="Software, August 2026, in USD"[^>]*>/.exec(out)![0]).toContain('value="120.00"');
    const empty = /<input [^>]*aria-label="Software, October 2026, in USD"[^>]*>/.exec(out)![0];
    expect(empty).toContain('placeholder="not entered"');
    expect(empty).not.toContain("value=");
    expect(out).not.toContain('value="0.00"');
    expect(out).not.toContain('value="0"');
  });

  it("shows the saved rates in the form", () => {
    const out = html();
    expect(/<input [^>]*value="2.9"[^>]*>/.test(out)).toBe(true);
    expect(/<input [^>]*value="0.30"[^>]*>/.test(out)).toBe(true);
    expect(/<input [^>]*value="4.50"[^>]*>/.test(out)).toBe(true);
  });

  describe("saving a cell", () => {
    it("sends one PUT in cents when the input loses focus, then refreshes the page", async () => {
      await blur(input(SOFTWARE_OCT), "125.5");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/api/ebitda/costs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "cell", month: "2026-10", category: "software", amountCents: 12_550 }),
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(text(html())).toContain("Saved Software for October 2026.");
    });

    it("understands a dollar sign, thousands separators and whole dollars", async () => {
      await blur(input(SOFTWARE_OCT), "$1,234.5");
      await blur(input(SOFTWARE_OCT), "40");
      await blur(input(SOFTWARE_OCT), "0");
      const sent = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).amountCents);
      expect(sent).toEqual([123_450, 4_000, 0]);
    });

    it("does not send anything when the amount has not changed", async () => {
      await blur(input(SOFTWARE_AUG), "120.00");
      await blur(input(SOFTWARE_AUG), " 120 ");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("does not send anything for a blank cell that was never entered", async () => {
      await blur(input(SOFTWARE_OCT), "   ");
      await blur(input(SOFTWARE_OCT), "");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(html()).not.toContain('role="alert"');
    });

    it("drops an earlier complaint about a cell that is left blank and was never entered, and still sends nothing", async () => {
      await blur(input(SOFTWARE_OCT), "abc");
      expect(html()).toContain('role="alert"');
      await blur(input(SOFTWARE_OCT), "");
      expect(html()).not.toContain('role="alert"');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      ["a seeded cell", SOFTWARE_AUG, "2026-08"],
      ["a cell a person edited", "Software, September 2026, in USD", "2026-09"],
    ])("removes %s when it is cleared: one PUT with a null amount, then a refresh", async (_label, aria, month) => {
      await blur(input(aria), "");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith("/api/ebitda/costs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "cell", month, category: "software", amountCents: null }),
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      const out = html();
      expect(text(out)).toMatch(/Cleared Software for (August|September) 2026\./);
      expect(out).not.toContain('role="alert"');
    });

    it("reads spaces as clearing the cell too", async () => {
      await blur(input(SOFTWARE_AUG), "   ");
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ kind: "cell", month: "2026-08", category: "software", amountCents: null });
    });

    it("does not clear a saved cell for text that is not an amount: it says what to type and sends nothing", async () => {
      await blur(input(SOFTWARE_AUG), "abc");
      await blur(input(SOFTWARE_AUG), "$");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(text(html())).toContain("Enter an amount in dollars and cents, like 1250.00.");
    });

    it("on a failed removal shows the server's message beside the cell, leaves the box blank for another try, and does not refresh", async () => {
      fetchMock.mockResolvedValue(answer(400, { error: "INVALID_INPUT", message: "That month is outside the data." }));
      const before = input(SOFTWARE_AUG);
      await blur(before, "");
      expect(refresh).not.toHaveBeenCalled();
      const out = html();
      expect(text(out)).toContain("That month is outside the data.");
      expect(text(out)).not.toContain("Cleared Software");
      expect(input(SOFTWARE_AUG).key).toBe(before.key); // the same element, so the browser keeps the box as it was
      await blur(input(SOFTWARE_AUG), "");
      expect(fetchMock).toHaveBeenCalledTimes(2); // the saved amount is still the server's, so leaving the box blank again asks again
    });

    it("says it plainly when the person is not allowed to remove, whatever the server's body", async () => {
      fetchMock.mockResolvedValue(answer(403, { error: "FORBIDDEN" }));
      await blur(input(SOFTWARE_AUG), "");
      expect(text(html())).toContain("Only Growth Capital roles can change the cost sheet.");
    });

    it("gives a removed cell a new key, so the box is drawn empty with 'not entered' once the page is refreshed without it", () => {
      const before = input(SOFTWARE_AUG);
      const after = input(SOFTWARE_AUG, { rows: ROWS.filter((r) => !(r.month === "2026-08" && r.category === "software")) });
      expect(after.key).not.toBe(before.key);
      expect(after.props.defaultValue).toBeUndefined();
      expect(after.props.placeholder).toBe("not entered");
    });

    it.each(["abc", "-5", "12.345", "1,2,3", "1e3", "$", "12 34"])("refuses %j without asking the server, says what to type, and keeps what was typed", async (typed) => {
      const before = input(SOFTWARE_OCT);
      await blur(before, typed);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      const out = html();
      expect(out).toContain('role="alert"');
      expect(text(out)).toContain("Enter an amount in dollars and cents, like 1250.00.");
      expect(input(SOFTWARE_OCT).key).toBe(before.key); // the same element, so the browser keeps the text in it
    });

    it("on a failed save shows the server's message beside that cell, keeps what was typed, and does not refresh", async () => {
      fetchMock.mockResolvedValue(answer(400, { error: "INVALID_INPUT", message: "That month is outside the data." }));
      const before = input(SOFTWARE_OCT);
      await blur(before, "125.50");
      expect(refresh).not.toHaveBeenCalled();
      const out = html();
      expect(text(/<td[^>]*>(?:(?!<\/td>)[\s\S])*aria-label="Software, October 2026, in USD"[\s\S]*?<\/td>/.exec(out)![0])).toContain("That month is outside the data.");
      expect(/<input [^>]*aria-label="Software, October 2026, in USD"[^>]*>/.exec(out)![0]).toContain('aria-invalid="true"');
      expect(out).not.toContain("Saved Software");
      // The input is the same element as before, so the browser keeps the text in it. A new key would replace it with the saved value.
      expect(input(SOFTWARE_OCT).key).toBe(before.key);
      expect(input(SOFTWARE_OCT).props.defaultValue).toBe(before.props.defaultValue);
    });

    it("says it plainly when the person is not allowed to edit, whatever the server's body", async () => {
      fetchMock.mockResolvedValue(answer(403, { error: "FORBIDDEN" }));
      await blur(input(SOFTWARE_OCT), "125.50");
      expect(text(html())).toContain("Only Growth Capital roles can change the cost sheet.");
    });

    it("says it could not save when the server's answer has no message, and when the network fails", async () => {
      fetchMock.mockResolvedValue(answer(500, { error: "INTERNAL_ERROR" }));
      await blur(input(SOFTWARE_OCT), "125.50");
      expect(text(html())).toContain("That did not save. Try again.");
      fetchMock.mockRejectedValue(new TypeError("fetch failed"));
      await blur(input(SOFTWARE_OCT), "126.50");
      expect(text(html())).toContain("Could not reach the server. Check your connection and try again.");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("clears a cell's error as soon as the next save of that cell works", async () => {
      await blur(input(SOFTWARE_OCT), "abc");
      expect(html()).toContain('role="alert"');
      await blur(input(SOFTWARE_OCT), "130");
      expect(html()).not.toContain('role="alert"');
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("gives a saved cell a new key, so the input shows the amount the server now holds", () => {
      const before = input(SOFTWARE_AUG).key;
      const after = input(SOFTWARE_AUG, { rows: ROWS.map((r) => (r.month === "2026-08" && r.category === "software" ? { ...r, amountCents: 13_000, source: "manual" as const } : r)) });
      expect(after.key).not.toBe(before);
      expect(after.props.defaultValue).toBe("130.00");
    });

    it("commits with Enter by leaving the cell", () => {
      const blurred = vi.fn();
      (input(SOFTWARE_OCT).props.onKeyDown as (e: unknown) => void)({ key: "Enter", currentTarget: { blur: blurred } });
      (input(SOFTWARE_OCT).props.onKeyDown as (e: unknown) => void)({ key: "a", currentTarget: { blur: blurred } });
      expect(blurred).toHaveBeenCalledTimes(1);
    });
  });

  describe("saving the rates", () => {
    it("sends the three rates in the units the server wants: basis points and cents", async () => {
      typeInto(rate("percent"), "2.95");
      typeInto(rate("fixed"), "0.35");
      typeInto(rate("fulfilment"), "5");
      await submitRates();
      expect(fetchMock).toHaveBeenCalledWith("/api/ebitda/costs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "assumptions", cardFeeBps: 295, cardFeeFixedCents: 35, fulfilmentCentsPerOrder: 500 }),
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(text(html())).toContain("Saved the rates.");
    });

    it("keeps what was typed in the form while it waits for the page to refresh", async () => {
      typeInto(rate("percent"), "3.1");
      await submitRates();
      expect(/<input [^>]*value="3.1"[^>]*>/.test(html())).toBe(true);
    });

    it("shows the new saved rates, not the old typing, once the page is refreshed with them", async () => {
      typeInto(rate("percent"), "3.1");
      await submitRates();
      const out = html({ assumptions: { cardFeeBps: 310, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 } });
      expect(/<input [^>]*value="3.1"[^>]*>/.test(out)).toBe(true);
      const other = html({ assumptions: { cardFeeBps: 250, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 } });
      expect(/<input [^>]*value="2.5"[^>]*>/.test(other)).toBe(true);
    });

    it("refuses a rate that is not a number without asking the server", async () => {
      typeInto(rate("fulfilment"), "lots");
      await submitRates();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(text(html())).toContain("Enter each rate as a number, like 2.9 or 0.30.");
    });

    it("shows a failed save of the rates and keeps the typing", async () => {
      fetchMock.mockResolvedValue(answer(400, { error: "INVALID_INPUT", message: "The card fee can be at most 10%." }));
      typeInto(rate("percent"), "12");
      await submitRates();
      const out = html();
      expect(text(out)).toContain("The card fee can be at most 10%.");
      expect(/<input [^>]*value="12"[^>]*>/.test(out)).toBe(true);
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  it("uses the currency it is given in the labels", () => {
    const out = html({ currency: "GBP" });
    expect(out).toContain('aria-label="Software, August 2026, in GBP"');
    expect(out).toContain("£");
  });
});
