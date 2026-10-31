// The contract between the Why work (T7: lib/why/) and the portfolio (T10: lib/portfolio/), which reads a brand's top driver.

export type DriverKind = "new_customer_orders" | "returning_customer_orders" | "new_customer_aov" | "returning_customer_aov" | "refunds";

// One part of a month's net-sales gap to plan. Money is in cents. The parts add up to the gap exactly (midpoint split).
export interface DriverNode {
  id: string;
  kind: DriverKind;
  label: string; // plain words, for example "New-customer orders"
  deltaCents: number; // negative when this part pulled net sales below plan
  shareOfGap: number | null; // fraction of the gap; null when the gap is 0
  planned: number; // the planned and actual values of this part's own measure (a count, cents or a rate)
  actual: number;
  unit: "count" | "money" | "rate";
}

export interface DriverTreeResult {
  month: string; // YYYY-MM
  targetCents: number; // the month's net sales target
  actualCents: number;
  gapCents: number; // actual - target
  drivers: DriverNode[]; // largest pull first (by absolute delta)
}
