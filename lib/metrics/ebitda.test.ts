import { describe, expect, it } from "vitest";
import { DEFAULT_PRICE_ELASTICITY, ebitdaLines, prorate, runScenario, volumeChangeForTarget, type ScenarioBase } from "./ebitda";

// The hand-worked example behind most of these tests: 10,000.00 of net sales from 100 orders (40 of them from new customers),
// 4,000.00 of cost of goods, 2,000.00 of ads and 2,500.00 of operating costs, at the default rates: card fees of 2.9% of net sales
// plus 30 cents an order, and 4.50 of fulfilment an order. Its EBITDA is 730.00.
const base: ScenarioBase = {
  netSalesCents: 1_000_000,
  orders: 100,
  newCustomerOrders: 40,
  costOfGoodsCents: 400_000,
  adSpendCents: 200_000,
  operatingCostsCents: 250_000,
};
const a = { cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 };

// True when every number anywhere in the value is finite: a NaN or an Infinity would show as a broken figure on the page.
const allFinite = (value: unknown): boolean =>
  typeof value === "number" ? Number.isFinite(value) : value !== null && typeof value === "object" ? Object.values(value).every(allFinite) : true;

describe("DEFAULT_PRICE_ELASTICITY", () => {
  it("is -1.5: a 5% price rise loses 7.5% of orders", () => {
    expect(DEFAULT_PRICE_ELASTICITY).toBe(-1.5);
  });
});

describe("ebitdaLines", () => {
  it("baseline bridge", () => {
    expect(ebitdaLines(base, a)).toEqual({
      netSalesCents: 1_000_000,
      costOfGoodsCents: 400_000,
      cardFeesCents: 32_000, // 2.9% of 1,000,000 is 29,000, and 30 cents on each of 100 orders is 3,000
      fulfilmentCents: 45_000,
      adSpendCents: 200_000,
      profitAfterVariableCostsCents: 323_000,
      operatingCostsCents: 250_000,
      ebitdaCents: 73_000,
      ebitdaRate: 0.073,
      profitAfterVariableCostsRate: 0.323,
    });
  });

  it("zero net sales gives null rates and no NaN", () => {
    const none = ebitdaLines({ netSalesCents: 0, orders: 0, costOfGoodsCents: 0, adSpendCents: 0, operatingCostsCents: 50_000 }, a);
    expect(none.ebitdaCents).toBe(-50_000);
    expect(none.profitAfterVariableCostsCents).toBe(0);
    expect(none.ebitdaRate).toBeNull();
    expect(none.profitAfterVariableCostsRate).toBeNull();
    expect(allFinite(none)).toBe(true);
  });

  it("gives no rate when refunds leave net sales below zero, because a rate over a negative base reads the wrong way round", () => {
    const refunded = ebitdaLines({ netSalesCents: -5_000, orders: 2, costOfGoodsCents: 0, adSpendCents: 0, operatingCostsCents: 1_000 }, a);
    expect(refunded.ebitdaRate).toBeNull();
    expect(refunded.profitAfterVariableCostsRate).toBeNull();
  });
});

describe("runScenario", () => {
  it("no levers: the scenario is the baseline and nothing is listed as an impact", () => {
    const result = runScenario(base, a, {});
    expect(result.baseline).toEqual({ ...ebitdaLines(base, a), orders: 100 });
    expect(result.scenario).toEqual(result.baseline);
    expect(result.deltaEbitdaCents).toBe(0);
    expect(result.impacts).toEqual([]);
  });

  it("ads -20%: lose 20% of the new-customer orders", () => {
    // Orders fall by 0.2 x 40 = 8, to 92, and everything that moves with orders falls by 8%. Ad spend falls by the full 20%.
    const { scenario, deltaEbitdaCents } = runScenario(base, a, { adSpendChange: -0.2 });
    expect(scenario.orders).toBe(92);
    expect(scenario.netSalesCents).toBe(920_000);
    expect(scenario.costOfGoodsCents).toBe(368_000);
    expect(scenario.cardFeesCents).toBe(29_440);
    expect(scenario.fulfilmentCents).toBe(41_400);
    expect(scenario.adSpendCents).toBe(160_000);
    expect(scenario.ebitdaCents).toBe(71_160);
    expect(deltaEbitdaCents).toBe(-1_840);
  });

  it("price +5% with the default elasticity", () => {
    // Orders fall 7.5%, to 92.5, which shows as 93. Fees and fulfilment are still worked out on 92.5, so a half order is not rounded up before it is costed.
    const result = runScenario(base, a, { priceChange: 0.05 });
    expect(result.scenario.orders).toBe(93);
    expect(result.scenario.netSalesCents).toBe(971_250);
    expect(result.scenario.cardFeesCents).toBe(30_941);
    expect(result.scenario.fulfilmentCents).toBe(41_625);
    expect(result.scenario.ebitdaCents).toBe(78_684);
    expect(result.deltaEbitdaCents).toBe(5_684);
    expect(runScenario(base, a, { priceChange: 0.05, elasticity: DEFAULT_PRICE_ELASTICITY })).toEqual(result);
  });

  it("price +5% with elasticity 0", () => {
    const result = runScenario(base, a, { priceChange: 0.05, elasticity: 0 });
    expect(result.scenario.orders).toBe(100);
    expect(result.scenario.ebitdaCents).toBe(121_550);
    expect(result.deltaEbitdaCents).toBe(48_550);
  });

  it("unit cost +8% -> 41_000; operating costs +10% -> 48_000", () => {
    const cost = runScenario(base, a, { unitCostChange: 0.08 });
    expect(cost.scenario.costOfGoodsCents).toBe(432_000);
    expect(cost.scenario.ebitdaCents).toBe(41_000);
    const operating = runScenario(base, a, { operatingCostChange: 0.1 });
    expect(operating.scenario.operatingCostsCents).toBe(275_000);
    expect(operating.scenario.ebitdaCents).toBe(48_000);
  });

  it("volume +10% sells 10% more of everything except ads and operating costs", () => {
    const result = runScenario(base, a, { volumeChange: 0.1 });
    expect(result.scenario.orders).toBe(110);
    expect(result.scenario.netSalesCents).toBe(1_100_000);
    expect(result.scenario.cardFeesCents).toBe(35_200);
    expect(result.scenario.fulfilmentCents).toBe(49_500);
    expect(result.scenario.adSpendCents).toBe(200_000);
    expect(result.scenario.ebitdaCents).toBe(125_300);
  });

  it("price -50% (orders rise 75% at the default elasticity)", () => {
    const { scenario } = runScenario(base, a, { priceChange: -0.5 });
    expect(scenario.orders).toBe(175);
    expect(scenario.netSalesCents).toBe(875_000);
    expect(scenario.ebitdaCents).toBe(-384_375);
  });

  it("extremes stay finite", () => {
    // Every order is from a new customer and the ads stop: nothing is left to sell, only the operating costs.
    const allNew = runScenario({ ...base, newCustomerOrders: 100 }, a, { adSpendChange: -1 });
    expect(allNew.scenario.orders).toBe(0);
    expect(allNew.scenario.netSalesCents).toBe(0);
    expect(allNew.scenario.adSpendCents).toBe(0);
    expect(allNew.scenario.ebitdaCents).toBe(-250_000);
    expect(allNew.scenario.ebitdaRate).toBeNull();
    expect(allFinite(allNew)).toBe(true);

    // Price halved and volume gone: no orders, so only the ads and the operating costs are left.
    const gone = runScenario(base, a, { priceChange: -0.5, volumeChange: -1 });
    expect(gone.scenario.orders).toBe(0);
    expect(gone.scenario.netSalesCents).toBe(0);
    expect(gone.scenario.cardFeesCents).toBe(0);
    expect(gone.scenario.ebitdaCents).toBe(-450_000);
    expect(allFinite(gone)).toBe(true);

    // A baseline with no sales at all, and the same levers pulled hard.
    const empty = runScenario({ netSalesCents: 0, orders: 0, newCustomerOrders: 0, costOfGoodsCents: 0, adSpendCents: 0, operatingCostsCents: 0 }, a, {
      priceChange: -0.5,
      adSpendChange: -1,
      unitCostChange: 0.5,
      volumeChange: 2,
      operatingCostChange: -1,
    });
    expect(empty.scenario.ebitdaCents).toBe(0);
    expect(empty.scenario.ebitdaRate).toBeNull();
    expect(allFinite(empty)).toBe(true);
  });

  it("never reports negative zero, which toBe and Object.is tell apart from zero and which would print as -0", () => {
    // A few cents of refunds leave net sales below zero, and a card fee on that rounds to -0 unless the rounding guards against it.
    expect(ebitdaLines({ netSalesCents: -10, orders: 0, costOfGoodsCents: 0, adSpendCents: 0, operatingCostsCents: 0 }, a).cardFeesCents).toBe(0);
    // The same refunds scaled by no orders at all: a negative amount times zero is -0.
    expect(runScenario({ ...base, netSalesCents: -5_000 }, a, { volumeChange: -1 }).scenario.netSalesCents).toBe(0);
  });

  it("a fall of 100% or more, or a rise that prices every order out, leaves nothing rather than a negative amount", () => {
    // +200% at the default elasticity would be a factor of -2 on orders; the floor is no orders.
    const priced = runScenario(base, a, { priceChange: 2 });
    expect(priced.scenario.orders).toBe(0);
    expect(priced.scenario.netSalesCents).toBe(0);
    expect(priced.scenario.ebitdaCents).toBe(-450_000);
    // Two negative factors must not multiply into a positive one: volume -150% and the same price rise.
    const both = runScenario(base, a, { priceChange: 2, volumeChange: -1.5 });
    expect(both.scenario.orders).toBe(0);
    expect(both.scenario.netSalesCents).toBe(0);
    // Costs cannot go below zero either.
    const cut = runScenario(base, a, { adSpendChange: -2, operatingCostChange: -3, unitCostChange: -1.5 });
    expect(cut.scenario.adSpendCents).toBe(0);
    expect(cut.scenario.operatingCostsCents).toBe(0);
    expect(cut.scenario.costOfGoodsCents).toBe(0);
  });

  it("every line is whole cents and the bridge adds up exactly", () => {
    const odd: ScenarioBase = { netSalesCents: 1_234_567, orders: 83, newCustomerOrders: 31, costOfGoodsCents: 456_789, adSpendCents: 123_457, operatingCostsCents: 98_765 };
    const { scenario } = runScenario(odd, a, { priceChange: 0.037, adSpendChange: -0.13, unitCostChange: 0.041, volumeChange: 0.09, operatingCostChange: 0.02 });
    const lines = [scenario.netSalesCents, scenario.costOfGoodsCents, scenario.cardFeesCents, scenario.fulfilmentCents, scenario.adSpendCents, scenario.operatingCostsCents];
    expect(lines.every((cents) => Number.isInteger(cents))).toBe(true);
    expect(Number.isInteger(scenario.orders)).toBe(true);
    expect(scenario.profitAfterVariableCostsCents).toBe(
      scenario.netSalesCents - scenario.costOfGoodsCents - scenario.cardFeesCents - scenario.fulfilmentCents - scenario.adSpendCents,
    );
    expect(scenario.ebitdaCents).toBe(scenario.profitAfterVariableCostsCents - scenario.operatingCostsCents);
  });

  it("impacts are each lever alone, in key order", () => {
    // Asked for in the opposite order to the Levers keys, the answer still comes back in key order.
    const result = runScenario(base, a, { adSpendChange: -0.2, priceChange: 0.05 });
    expect(result.impacts).toEqual([
      { lever: "priceChange", deltaEbitdaCents: 5_684 },
      { lever: "adSpendChange", deltaEbitdaCents: -1_840 },
    ]);
    // Together the two do not add up to the sum of the two (3,844): the cheaper ads lose new-customer orders from a base the price rise has already thinned.
    expect(result.scenario.orders).toBe(85);
    expect(result.scenario.ebitdaCents).toBe(76_389);
    expect(result.deltaEbitdaCents).toBe(3_389);
  });

  it("lists all five levers in the order the Levers type declares them, and only the ones that are set", () => {
    const all = runScenario(base, a, { operatingCostChange: 0.1, volumeChange: 0.1, unitCostChange: 0.08, adSpendChange: -0.2, priceChange: 0.05 });
    expect(all.impacts.map((impact) => impact.lever)).toEqual(["priceChange", "adSpendChange", "unitCostChange", "volumeChange", "operatingCostChange"]);
    expect(all.impacts.map((impact) => impact.deltaEbitdaCents)).toEqual([5_684, -1_840, -32_000, 52_300, -25_000]);
    // The elasticity is an assumption about price, not a lever, so on its own it lists nothing. A lever set to zero is listed, with no impact.
    expect(runScenario(base, a, { elasticity: -2 }).impacts).toEqual([]);
    expect(runScenario(base, a, { priceChange: 0 }).impacts).toEqual([{ lever: "priceChange", deltaEbitdaCents: 0 }]);
  });

  it("a price lever alone uses the elasticity it was given", () => {
    const result = runScenario(base, a, { priceChange: 0.05, elasticity: 0 });
    expect(result.impacts).toEqual([{ lever: "priceChange", deltaEbitdaCents: 48_550 }]);
  });
});

describe("volumeChangeForTarget", () => {
  it("finds the order count that reaches a target with no other lever", () => {
    // Each 100 orders bring 523,000 before ads and operating costs (971,000 after the card rate, less 400,000 of goods and 48,000 of
    // per-order fees and fulfilment), and the 450,000 of ads and operating costs does not move: (150,000 + 450,000) / 523,000 = 1.1472.
    const need = volumeChangeForTarget(base, a, {}, 150_000);
    expect(need).not.toBeNull();
    expect(need!.ordersNeeded).toBe(115);
    expect(need!.volumeChange).toBeCloseTo(0.1472, 4);
  });

  it("can ask for fewer orders: break-even is below the baseline when the baseline makes a profit", () => {
    const need = volumeChangeForTarget(base, a, {}, 0);
    expect(need!.ordersNeeded).toBe(86);
    expect(need!.volumeChange).toBeCloseTo(-0.1396, 4);
  });

  it("has no answer when more volume only loses money", () => {
    // Cost of goods above net sales: every extra order makes the loss bigger.
    expect(volumeChangeForTarget({ ...base, costOfGoodsCents: 1_100_000 }, a, {}, 150_000)).toBeNull();
    // A baseline with nothing in it has nothing to scale.
    expect(volumeChangeForTarget({ netSalesCents: 0, orders: 0, newCustomerOrders: 0, costOfGoodsCents: 0, adSpendCents: 0, operatingCostsCents: 0 }, a, {}, 1_000)).toBeNull();
  });

  it("has no answer when the target is below what no orders at all would lose", () => {
    // With no orders the 450,000 of ads and operating costs still leaves -450,000, and a volume change cannot go lower than -100%.
    expect(volumeChangeForTarget(base, a, {}, -500_000)).toBeNull();
    expect(volumeChangeForTarget(base, a, {}, -450_000)).toEqual({ volumeChange: -1, ordersNeeded: 0 });
  });

  it("has no answer when the other levers have already taken every order away", () => {
    expect(volumeChangeForTarget({ ...base, newCustomerOrders: 100 }, a, { adSpendChange: -1 }, 10_000)).toBeNull();
  });

  it("measures the change against the orders left after the other levers, and reaches the target when run forward", () => {
    for (const levers of [{}, { priceChange: 0.05, adSpendChange: -0.2 }, { unitCostChange: 0.08, operatingCostChange: -0.1, elasticity: -0.5 }]) {
      const need = volumeChangeForTarget(base, a, levers, 100_000);
      expect(need).not.toBeNull();
      const forward = runScenario(base, a, { ...levers, volumeChange: need!.volumeChange });
      // Six rounded lines can be at most three cents from the exact figure.
      expect(Math.abs(forward.scenario.ebitdaCents - 100_000)).toBeLessThanOrEqual(3);
      expect(forward.scenario.orders).toBe(need!.ordersNeeded);
    }
  });

  it("ignores a volume change already in the levers, because that is what it solves for", () => {
    expect(volumeChangeForTarget(base, a, { volumeChange: 0.5, priceChange: 0.05 }, 100_000)).toEqual(volumeChangeForTarget(base, a, { priceChange: 0.05 }, 100_000));
  });
});

describe("prorate", () => {
  it("takes the elapsed share of a month's amount, to the nearest cent", () => {
    expect(prorate(300_000, 10, 30)).toBe(100_000);
    expect(prorate(250_000, 15, 31)).toBe(120_968);
  });

  it("is the whole amount for a whole month and none for none, and never more or less than that", () => {
    expect(prorate(250_000, 31, 31)).toBe(250_000);
    expect(prorate(250_000, 0, 31)).toBe(0);
    expect(prorate(250_000, 40, 31)).toBe(250_000);
    expect(prorate(250_000, -3, 31)).toBe(0);
    expect(prorate(250_000, 10, 0)).toBe(0);
  });
});
