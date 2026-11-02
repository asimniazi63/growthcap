// Shared by the EBITDA engine, the cost-sheet loaders, the two agent tools, the /ebitda page and its client components.
// Types and constants only: no database or React imports, so a client component can import this file.

export const COST_CATEGORIES = ["payroll", "software", "rent", "contractors", "other"] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

// "fixture" rows come from the seeded CSV files and are replaced by a reload; "manual" rows were typed in by a person and a reload never overwrites them.
export type CostSource = "fixture" | "manual";

// The rates that turn net sales and orders into card fees and fulfilment cost. They are assumptions, not Shopify data.
export interface CostAssumptions {
  cardFeeBps: number; // basis points of net sales: 290 is 2.9%
  cardFeeFixedCents: number; // per order
  fulfilmentCentsPerOrder: number;
}

export const DEFAULT_ASSUMPTIONS: CostAssumptions = { cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 };

// One cell of the cost sheet: a month's operating cost in one category.
export interface CostSheetRow {
  month: string; // YYYY-MM
  category: CostCategory;
  amountCents: number;
  source: CostSource;
}

// The bridge from net sales to EBITDA for one month, or for a total over several. Money is whole cents. Each line is rounded and
// ebitdaCents is the sum of the rounded lines, so the bridge on the page adds up exactly.
export interface EbitdaLines {
  netSalesCents: number;
  costOfGoodsCents: number;
  cardFeesCents: number;
  fulfilmentCents: number;
  adSpendCents: number;
  profitAfterVariableCostsCents: number; // net sales - cost of goods - card fees - fulfilment - ad spend
  operatingCostsCents: number;
  ebitdaCents: number; // profit after variable costs - operating costs
  ebitdaRate: number | null; // as a fraction of net sales; null when there were no net sales
  profitAfterVariableCostsRate: number | null; // the same, for profit after variable costs
}

export interface EbitdaMonth extends EbitdaLines {
  month: string; // YYYY-MM
  partial: boolean; // the range stops before the month's last day; operating costs are prorated by elapsed days
  orders: number;
  newCustomerOrders: number;
  operatingCosts: { category: CostCategory; amountCents: number }[]; // empty when nothing was entered for the month
  operatingCostsEntered: boolean;
  unitsWithoutCost: number; // units sold on variants that have no unit cost, which have no cost of goods here
  ebitdaIsCeiling: boolean; // operating costs were not entered, or some units have no unit cost: costs are missing, so the true EBITDA is no higher than shown
}

// Where each line of the bridge comes from, in words a person can read. The keys are fixed so the page can lay the receipts out.
export type EbitdaSourceKey = "netSales" | "costOfGoods" | "cardFees" | "fulfilment" | "adSpend" | "operatingCosts";

// What get_ebitda returns as `data`, and what the /ebitda page draws.
export interface EbitdaData {
  months: EbitdaMonth[];
  total: EbitdaLines & { orders: number; unitsWithoutCost: number; ebitdaIsCeiling: boolean };
  cardFeeRate: number; // a fraction: 0.029 is 2.9%
  cardFeeFixedCents: number;
  fulfilmentCentsPerOrder: number;
  assumptionsSource: CostSource | "default";
  sources: Record<EbitdaSourceKey, string>;
}
