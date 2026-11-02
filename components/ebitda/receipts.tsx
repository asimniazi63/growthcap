import type { EbitdaData, EbitdaSourceKey } from "@/lib/ebitda/types";
import { formatUnit } from "@/lib/pace/format";

// Where each line of the bridge comes from, in the words the data carries (data.sources), and the rates that card fees and fulfilment are
// worked out from. Those two lines are assumptions, not Shopify data, so the rates are listed in full. The data does not say who last
// edited the cost sheet, so this does not either.

const LINES: { key: EbitdaSourceKey; label: string }[] = [
  { key: "netSales", label: "Net sales" },
  { key: "costOfGoods", label: "Cost of goods" },
  { key: "cardFees", label: "Card fees" },
  { key: "fulfilment", label: "Fulfilment" },
  { key: "adSpend", label: "Ad spend" },
  { key: "operatingCosts", label: "Operating costs" },
];

const RATES_FROM: Record<EbitdaData["assumptionsSource"], string> = {
  fixture: "Cost sheet (seeded demo data)",
  manual: "Cost sheet (edited by a person)",
  default: "Built-in defaults: no rates have been saved for this brand",
};

// The rate as it was entered, with no trailing zeros: 0.029 is 2.9%, 0.0295 is 2.95% and 0.03 is 3%.
const percent = (fraction: number) => `${Number((fraction * 100).toFixed(2))}%`;

const ROW = "grid gap-x-6 gap-y-0.5 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)]";

export function Receipts({ data, currency = "USD" }: { data: EbitdaData; currency?: string }) {
  const money = (cents: number) => formatUnit("money", cents, currency);
  return (
    <div className="space-y-6 text-sm">
      <dl className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {LINES.map(({ key, label }) => (
          <div key={key} className={ROW}>
            <dt className="font-medium">{label}</dt>
            <dd className="muted">{data.sources[key]}</dd>
          </div>
        ))}
      </dl>

      <div>
        <h3 className="font-semibold">Assumed rates</h3>
        <p className="muted mt-0.5">Card fees and fulfilment are not read from Shopify. They are worked out from these rates.</p>
        <dl className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          <div className={ROW}>
            <dt className="font-medium">Card fees</dt>
            <dd className="num">
              {percent(data.cardFeeRate)} of net sales plus {money(data.cardFeeFixedCents)} per order
            </dd>
          </div>
          <div className={ROW}>
            <dt className="font-medium">Fulfilment</dt>
            <dd className="num">{money(data.fulfilmentCentsPerOrder)} per order</dd>
          </div>
          <div className={ROW}>
            <dt className="font-medium">Where the rates come from</dt>
            <dd className="muted">{RATES_FROM[data.assumptionsSource]}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
