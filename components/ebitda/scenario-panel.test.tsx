import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CostAssumptions } from "@/lib/ebitda/types";
import { DEFAULT_PRICE_ELASTICITY, runScenario, volumeChangeForTarget, type Levers, type ScenarioBase } from "@/lib/metrics/ebitda";
import { ScenarioPanel } from "./scenario-panel";

// The repo has no browser-like DOM for tests, so this runs in plain Node, as components/settings/appearance-form.test.tsx does. useState is
// replaced by a small store that keeps its values from one render to the next. The real panel runs unchanged: a test reads the element
// tree it returns to find a slider or a button, calls its handler with a stand-in event, and renders again to see what a person would
// see. The panel keeps all its state in its own top-level useState calls, which is what makes this work.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
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

beforeEach(() => {
  hooks.slots = [];
});

// Three months of a brand, added together as scenarioBaseOf does: the engine's worked example times three. Baseline EBITDA is $2,190.00 over
// the three months, $730.00 a month, and taking a fifth off the ads costs it a few dollars (the new-customer orders that go are worth more
// than the ads saved).
const BASE: ScenarioBase = { netSalesCents: 3_000_000, orders: 300, newCustomerOrders: 120, costOfGoodsCents: 1_200_000, adSpendCents: 600_000, operatingCostsCents: 750_000 };
const ASSUMPTIONS: CostAssumptions = { cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 };
const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

type Props = Parameters<typeof ScenarioPanel>[0];
const props = (over: Partial<Props> = {}): Props => ({ base: BASE, assumptions: ASSUMPTIONS, months: 3, ...over });
const html = (over: Partial<Props> = {}) => {
  hooks.cursor = 0;
  return renderToStaticMarkup(<ScenarioPanel {...props(over)} />);
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
  return elements(ScenarioPanel(props(over)));
};
const byId = (id: string, over: Partial<Props> = {}) => {
  const found = tree(over).find((e) => e.props.id === id);
  if (!found) throw new Error(`nothing with id ${id}`);
  return found;
};
const change = (id: string, value: string, over: Partial<Props> = {}) => (byId(id, over).props.onChange as (e: unknown) => void)({ currentTarget: { value } });
const slide = (lever: string, percent: number, over: Partial<Props> = {}) => change(`scenario-${lever}`, String(percent), over);
const reset = () => (tree().find((e) => e.type === "button" && text(renderToStaticMarkup(<>{e.props.children}</>)) === "Reset")!.props.onClick as () => void)();

// What the panel shows for a set of levers, from the engine: the oracle for "the same figures as the chat tool".
const expected = (levers: Levers) => runScenario(BASE, ASSUMPTIONS, { elasticity: DEFAULT_PRICE_ELASTICITY, ...levers });
const perMonth = (cents: number) => Math.round(cents / 3) + 0;
const row = (out: string, label: string) => text(new RegExp(`<tr[^>]*><th[^>]*>${label}</th>[\\s\\S]*?</tr>`).exec(out)![0]);

const LEVER_IDS = ["priceChange", "adSpendChange", "unitCostChange", "volumeChange", "operatingCostChange"];
// The opening tag of the input with this id.
const tagOf = (out: string, id: string) => [...out.matchAll(/<input[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(` id="${id}"`)) ?? "";

describe("ScenarioPanel: the levers", () => {
  it("has five sliders, one for each lever, each labelled, each starting at zero", () => {
    const out = html();
    const sliders = [...out.matchAll(/<input[^>]*type="range"[^>]*>/g)].map((m) => m[0]);
    expect(sliders).toHaveLength(5);
    for (const id of LEVER_IDS) expect(out).toContain(`id="scenario-${id}"`);
    for (const label of ["Price", "Ad spend", "Unit cost", "Order volume", "Operating costs"]) expect(out).toMatch(new RegExp(`<label[^>]*>${label}</label>`));
    for (const s of sliders) {
      expect(s).toContain('value="0"');
      expect(Number(/min="(-?\d+)"/.exec(s)![1])).toBeLessThan(0);
      expect(Number(/max="(-?\d+)"/.exec(s)![1])).toBeGreaterThan(0);
      expect(s).toContain('step="1"');
    }
    expect(text(out)).toContain("0%");
  });

  it("starts with nothing changed: the scenario is the baseline and the change is nothing", () => {
    const out = html();
    const base = expected({});
    expect(base.deltaEbitdaCents).toBe(0);
    expect(row(out, "Baseline")).toContain(usd(perMonth(base.baseline.ebitdaCents)));
    expect(row(out, "With your changes")).toBe(row(out, "Baseline").replace("Baseline", "With your changes"));
    expect(row(out, "Change")).toBe("Change no change");
  });

  it("moving the ad slider to -20% shows the same delta as runScenario for those inputs", () => {
    slide("adSpendChange", -20);
    const out = html();
    const want = expected({ adSpendChange: -0.2 });
    expect(want.deltaEbitdaCents).not.toBe(0); // a check that the numbers differ, so this cannot pass by showing zeros
    expect(want.deltaEbitdaCents).toBeLessThan(0); // 20% of the new-customer orders go with the ads
    const down = `down ${usd(-want.deltaEbitdaCents)}`;
    // Over the three months, exactly as runScenario gives it ...
    expect(row(out, "Change")).toContain(down);
    expect(row(out, "Baseline")).toContain(usd(want.baseline.ebitdaCents));
    expect(row(out, "With your changes")).toContain(usd(want.scenario.ebitdaCents));
    // ... and a month at a time.
    expect(row(out, "Baseline")).toContain(usd(perMonth(want.baseline.ebitdaCents)));
    expect(row(out, "With your changes")).toContain(usd(perMonth(want.scenario.ebitdaCents)));
    expect(text(out)).toContain("−20%");
    expect(tagOf(out, "scenario-adSpendChange")).toContain('value="-20"');
  });

  it("says an increase is 'up' and a decrease is 'down', and names the size without a minus sign", () => {
    slide("priceChange", 5);
    const up = expected({ priceChange: 0.05 });
    expect(up.deltaEbitdaCents).toBeGreaterThan(0);
    expect(row(html(), "Change")).toContain(`up ${usd(up.deltaEbitdaCents)}`);
    slide("priceChange", -5);
    const down = expected({ priceChange: -0.05 });
    expect(down.deltaEbitdaCents).toBeLessThan(0);
    expect(row(html(), "Change")).toContain(`down ${usd(-down.deltaEbitdaCents)}`);
    expect(row(html(), "Change")).not.toContain("-$");
  });

  it("combines all five levers the way runScenario does, and shows each lever's setting", () => {
    const set = { priceChange: 5, adSpendChange: -10, unitCostChange: 8, volumeChange: 3, operatingCostChange: 10 };
    for (const [lever, v] of Object.entries(set)) slide(lever, v);
    const want = expected({ priceChange: 0.05, adSpendChange: -0.1, unitCostChange: 0.08, volumeChange: 0.03, operatingCostChange: 0.1 });
    const out = html();
    expect(row(out, "With your changes")).toContain(usd(want.scenario.ebitdaCents));
    expect(row(out, "Change")).toContain(want.deltaEbitdaCents >= 0 ? `up ${usd(want.deltaEbitdaCents)}` : `down ${usd(-want.deltaEbitdaCents)}`);
    for (const [lever, v] of Object.entries(set)) expect(tagOf(out, `scenario-${lever}`)).toContain(`value="${v}"`);
    for (const shown of ["+5%", "−10%", "+8%", "+3%", "+10%"]) expect(text(out)).toContain(shown);
  });

  it("gives each slider a value in words for a screen reader", () => {
    slide("adSpendChange", -20);
    const out = html();
    expect(tagOf(out, "scenario-adSpendChange")).toContain('aria-valuetext="−20%"');
    expect(tagOf(out, "scenario-priceChange")).toContain('aria-valuetext="0%"');
  });

  it("reset returns every lever to zero and the delta to 0", () => {
    slide("adSpendChange", -20);
    slide("priceChange", 10);
    change("scenario-elasticity", "-2");
    change("scenario-target", "2000");
    expect(row(html(), "Change")).not.toBe("Change no change");
    reset();
    const out = html();
    for (const id of LEVER_IDS) expect(tagOf(out, `scenario-${id}`)).toContain('value="0"');
    expect(row(out, "Change")).toBe("Change no change");
    expect(tagOf(out, "scenario-elasticity")).toContain(`value="${DEFAULT_PRICE_ELASTICITY}"`);
    expect(tagOf(out, "scenario-target")).toContain('value=""');
  });

  it("stays finite at the ends of every slider, and with a brand that sold nothing", () => {
    const extremes: [string, number][] = [["priceChange", -50], ["adSpendChange", -100], ["unitCostChange", 50], ["volumeChange", -50], ["operatingCostChange", 100]];
    for (const [lever, v] of extremes) slide(lever, v);
    const allNew = { base: { ...BASE, newCustomerOrders: BASE.orders } };
    for (const over of [{}, allNew, { base: { netSalesCents: 0, orders: 0, newCustomerOrders: 0, costOfGoodsCents: 0, adSpendCents: 0, operatingCostsCents: 0 } }]) {
      const out = html(over);
      expect(out).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});

describe("ScenarioPanel: the elasticity", () => {
  it("labels the elasticity as an assumption, and the -1.5 as the default", () => {
    const out = html();
    expect(text(out)).toContain("assumption (default −1.5)");
    expect(text(out)).toContain("Price elasticity");
    expect(tagOf(out, "scenario-elasticity")).toContain('value="-1.5"');
    expect(tagOf(out, "scenario-elasticity")).toContain('aria-describedby="scenario-elasticity-note"');
    expect(out).toContain('id="scenario-elasticity-note"');
  });

  it("uses the elasticity a person types: a price rise with elasticity 0 loses no orders", () => {
    slide("priceChange", 5);
    change("scenario-elasticity", "0");
    const want = runScenario(BASE, ASSUMPTIONS, { priceChange: 0.05, elasticity: 0 });
    const withDefault = expected({ priceChange: 0.05 });
    expect(want.deltaEbitdaCents).not.toBe(withDefault.deltaEbitdaCents);
    expect(row(html(), "Change")).toContain(`up ${usd(want.deltaEbitdaCents)}`);
  });

  it.each(["", "abc", "1", "0.5", "-6", "-", "NaN", "Infinity"])("falls back to the default and says so when the elasticity is %j", (typed) => {
    slide("priceChange", 5);
    change("scenario-elasticity", typed);
    const out = html();
    expect(text(out)).toContain("Using the default −1.5 until this is a number from −5 to 0.");
    expect(row(out, "Change")).toContain(`up ${usd(expected({ priceChange: 0.05 }).deltaEbitdaCents)}`);
  });

  it("does not complain about an elasticity within range, at either end", () => {
    for (const typed of ["-5", "-1.5", "0", "-0.4"]) {
      hooks.slots = [];
      change("scenario-elasticity", typed);
      expect(text(html())).not.toContain("Using the default");
    }
  });
});

describe("ScenarioPanel: the target", () => {
  const ELASTICITY: Levers = { elasticity: DEFAULT_PRICE_ELASTICITY };
  const pct = (fraction: number) => `${fraction < 0 ? "−" : "+"}${Math.abs(fraction * 100).toFixed(1)}%`;

  it("shows what volumeChangeForTarget returns for a target a month, in orders a month", () => {
    change("scenario-target", "1,500");
    const want = volumeChangeForTarget(BASE, ASSUMPTIONS, ELASTICITY, 150_000 * 3)!;
    expect(want.volumeChange).toBeGreaterThan(0);
    const out = text(html());
    expect(out).toContain("Target EBITDA per month");
    expect(out).toContain(`To reach $1,500.00 a month, set Order volume to about ${pct(want.volumeChange)}: roughly ${Math.round(want.ordersNeeded / 3)} orders a month instead of ${BASE.orders / 3}.`);
    // $1,500 a month is the worked example's $150,000 target: 115 orders a month instead of 100.
    expect(out).toContain("roughly 115 orders a month instead of 100.");
  });

  it("takes the other levers into account, as the engine does", () => {
    slide("adSpendChange", -20);
    change("scenario-target", "1500");
    const want = volumeChangeForTarget(BASE, ASSUMPTIONS, { ...ELASTICITY, adSpendChange: -0.2 }, 150_000 * 3)!;
    const alone = volumeChangeForTarget(BASE, ASSUMPTIONS, ELASTICITY, 150_000 * 3)!;
    expect(pct(want.volumeChange)).not.toBe(pct(alone.volumeChange)); // so the ads slider was passed to the engine
    expect(text(html())).toContain(`set Order volume to about ${pct(want.volumeChange)}: roughly ${Math.round(want.ordersNeeded / 3)} orders a month`);
  });

  it("ignores where the Order volume slider already is, because that is what the target solves for", () => {
    const answer = () => /To reach.*? instead of \d+\./.exec(text(html()))![0];
    change("scenario-target", "1500");
    const before = answer();
    slide("volumeChange", 40);
    expect(answer()).toBe(before);
  });

  it("says so when the settings already reach the target, instead of asking for a change of nothing", () => {
    change("scenario-target", "730"); // the baseline: $2,190.00 over three months
    expect(volumeChangeForTarget(BASE, ASSUMPTIONS, ELASTICITY, 219_000)!.volumeChange).toBeCloseTo(0, 10);
    expect(text(html())).toContain("These settings already reach $730.00 a month: no change in order volume is needed.");
  });

  it("reads a target below today's EBITDA as fewer orders", () => {
    change("scenario-target", "100");
    const want = volumeChangeForTarget(BASE, ASSUMPTIONS, ELASTICITY, 10_000 * 3)!;
    expect(want.volumeChange).toBeLessThan(0);
    expect(text(html())).toContain(`set Order volume to about ${pct(want.volumeChange)}:`);
  });

  it("accepts a negative target, a dollar sign and cents", () => {
    change("scenario-target", "-$500.50");
    const want = volumeChangeForTarget(BASE, ASSUMPTIONS, ELASTICITY, -50_050 * 3);
    expect(want).not.toBeNull();
    expect(text(html())).toContain("To reach -$500.50 a month");
  });

  it("says no change in volume gets there when the engine has no answer", () => {
    // Each order costs more than it brings in, so selling more only loses more.
    const losing: ScenarioBase = { ...BASE, costOfGoodsCents: 3_000_000 };
    change("scenario-target", "1500", { base: losing });
    expect(volumeChangeForTarget(losing, ASSUMPTIONS, ELASTICITY, 450_000)).toBeNull();
    const out = text(html({ base: losing }));
    expect(out).toContain("Changing order volume alone cannot reach that with these settings.");
    expect(out).not.toContain("To reach");
  });

  it("asks for a target while the field is empty, and for dollars when it is not a number", () => {
    expect(text(html())).toContain("Type the EBITDA you want each month to see how many orders it would take.");
    change("scenario-target", "lots");
    expect(text(html())).toContain("Enter the target in dollars, like 5000.");
    expect(text(html())).not.toContain("To reach");
  });

  it("answers in a region a screen reader can find from the field", () => {
    const out = html();
    expect(tagOf(out, "scenario-target")).toContain('aria-describedby="scenario-target-answer"');
    expect(out).toContain('id="scenario-target-answer"');
  });
});

describe("ScenarioPanel: what it says about itself", () => {
  it("states the ad-spend rule in plain words, and that it is a guess", () => {
    const out = text(html());
    expect(out).toContain("new-customer orders by the same percentage");
    expect(out).toContain("returning-customer orders alone");
    expect(out).toContain("an assumption, not something measured");
  });

  it("says which months it is based on, and shows the whole period under each figure only when it is more than one month", () => {
    const three = html();
    expect(text(three)).toContain("Based on the last 3 complete months, shown a month at a time and over the 3 months.");
    expect(row(three, "Baseline")).toContain(`${usd(expected({}).baseline.ebitdaCents)} over 3 months`);
    const one = html({ months: 1 });
    expect(text(one)).toContain("Based on the last complete month.");
    expect(row(one, "Baseline")).not.toContain("over");
  });

  it("treats a months count that is not a positive number as one month, and never divides by it", () => {
    for (const months of [0, -2, NaN, Infinity]) {
      const out = html({ months });
      expect(out).not.toMatch(/NaN|undefined|Infinity/);
      expect(text(out)).toContain("Based on the last complete month.");
    }
  });

  it("makes a base made of months with missing costs a ceiling, in words, only when told so", () => {
    expect(text(html())).not.toContain("ceiling");
    const out = text(html({ baselineIsCeiling: true }));
    expect(out).toContain("The baseline is a ceiling");
    expect(out).toContain("no higher than shown");
  });

  it("announces the change to a screen reader in one sentence, and leaves the table out of the live region", () => {
    slide("adSpendChange", -20);
    const out = html();
    const live = /<p role="status" class="sr-only">([^<]*)<\/p>/.exec(out)![1]!;
    expect(live).toContain(`down ${usd(-expected({ adSpendChange: -0.2 }).deltaEbitdaCents)}`);
    expect(out.match(/role="status"/g)).toHaveLength(1);
  });

  it("uses the currency it is given", () => {
    slide("adSpendChange", -20);
    const out = html({ currency: "GBP" });
    expect(row(out, "Baseline")).toContain("£");
    expect(row(out, "Baseline")).not.toContain("$");
  });
});
