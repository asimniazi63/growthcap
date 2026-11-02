# EBITDA Calculator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Oasis Pace shows a brand's EBITDA by month from its synced store data plus a seeded, editable cost sheet, lets a person (or the agent) pressure-test it with what-if levers, and every figure stays traceable to a source.

**Architecture:** A pure engine (`lib/metrics/ebitda.ts`) does all the arithmetic and is shared by two agent tools, the `/ebitda` page and its scenario panel, so chat and page show the same figures. Shopify supplies sales, product costs and orders; the existing ad-spend file supplies ads; a new per-brand cost sheet (two small tables, seeded from CSV fixtures, editable by Growth Capital roles) supplies operating costs and the card-fee and fulfilment rates. Nothing is written to Shopify.

**Tech Stack:** Next.js 16 App Router (TypeScript), Drizzle with Postgres (PGlite in tests), zod 4, Vitest 5, the existing number checker and eval harness.

**Spec:** No separate design document. The design was agreed in conversation on 2026-11-03 and is summarised under "Design" below; calls I made are marked *(my call)* and listed under "Decisions for Asim". Written against `main` at `63d573b`. Proposed ticket number **T22** (T19 was dropped, T20 shipped, T21 is the closed visual layer); Asim opens the GitHub issue.

**Scope note:** The Creative Strategist and the profit-to-creative loop are separate plans that start after this one is approved and built. This plan stands alone.

## Global Constraints

- **Git:** Claude never stages, commits or pushes (`CLAUDE.md`; the stretch-build exception ended with T11). Tasks end with checks, not commits. The ticket ends with the changed-file list and a suggested commit message with no Co-Authored-By line.
- **Tests while building:** `npm run typecheck`, `npm run lint`, `npx vitest run <the test files you changed>`. The full `npm test` runs once, in Task 7. `npm run eval` runs once, in Task 7, after telling Asim (it is paid).
- **Ask Asim first** before `npm run db:migrate`, before `npm run fixtures:load` against Neon, and before any deploy. `npm run seed:load` is not involved: nothing goes into Shopify.
- **Tenant:** from the Clerk session only (`getTenantContext` / `withTenant`). Never from a tool argument, a request body or the model. Every tool input is a `z.strictObject`, so an unknown key (a tenant, a shop) is `INVALID_INPUT`.
- **Numbers:** every number the agent states comes from a tool result. Money is a flat key ending in `Cents`. Rates are fractions and their key names are in `RATE_KEYS` (`lib/agent/checker.ts:27`). Never name an object `values`, `previous` or `change`. Never use a record keyed by category for money (its keys would read as counts): use an array of `{ category, amountCents }`.
- **Database:** additive migration only. No column may be named name, email, phone or address (the personal-data schema test in `lib/sync/sync.test.ts:195`). Generate the migration with `npm run db:generate`; do not hand-number it (the T16 plan also reserves `0009`; whichever lands second takes the next number).
- **Dates:** store-local strings (`YYYY-MM-DD`, months `YYYY-MM`). "Today" comes from `todayFor` (`lib/tools/common.ts`).
- **Store text is untrusted.** Nothing in this plan renders store text, but the category list is a closed enum so the cost sheet cannot carry free text into a prompt.
- **Artifacts:** nothing is published online.

## Design

**What EBITDA means here.** Net sales − cost of goods − card fees − fulfilment − ad spend − operating costs. The subtotal before operating costs is named **profit after variable costs**, not "contribution margin", because `get_unit_economics` already uses that name for net sales − cost of goods − ad spend and two meanings would confuse the agent and the checker. `get_unit_economics` is left alone.

| Line | Source | Receipt wording |
|---|---|---|
| Net sales, orders, new-customer orders | Shopify orders, synced | "Shopify orders (synced)" |
| Cost of goods | Unit cost on each variant × units kept (today's cost, as in unit economics) | "Unit costs in Shopify × units sold" |
| Ad spend | `ad-spend.csv` loaded into the database | "Ad spend file (not from Shopify)" |
| Card fees | `cardFeeBps` × net sales + `cardFeeFixedCents` × orders | "Assumed rate: 2.9% + 30¢" (values shown) |
| Fulfilment | `fulfilmentCentsPerOrder` × orders | "Assumed: $4.50 per order" |
| Operating costs | Cost sheet rows per month and category | "Cost sheet (seeded demo data)" or "(edited by a person)" |

**Seeded data is sized to the stores.** Solenne's net sales are about $6,000 a month and Tidepool's about $1,000, so a realistic payroll would swamp them. The cost sheet is a founder-run brand: small software bills, a part-time contractor, a one-off. Planted storylines (Solenne only, like the dataset's): a software bill that creeps up each quarter, a part-time creative contractor from March 2026, a one-off $900 shoot in June 2026. Tidepool spends about 70% of its sales on ads and never breaks even, and the calculator says so. The amounts in Task 1 are starting values; Task 3 checks the sign mix and the amounts are tuned there.

**Scenario levers**, all fractions (0.05 is +5%): `priceChange`, `adSpendChange`, `unitCostChange`, `volumeChange`, `operatingCostChange`, plus `elasticity` (default `-1.5`, labelled an assumption; shared constant `DEFAULT_PRICE_ELASTICITY`). The baseline is the last N complete months (default 3).

```
orderFactor   = (1 + volumeChange) × (1 + elasticity × priceChange) × (1 + adSpendChange × newCustomerOrders / orders)   (floored at 0)
netSales'     = netSales × orderFactor × (1 + priceChange)
costOfGoods'  = costOfGoods × orderFactor × (1 + unitCostChange)
cardFees'     = cardFeeBps/10000 × netSales' + cardFeeFixedCents × orders'     orders' = orders × orderFactor
fulfilment'   = fulfilmentCentsPerOrder × orders'
adSpend'      = adSpend × (1 + adSpendChange)
operating'    = operatingCosts × (1 + operatingCostChange)
```

The ad-spend rule is the one guess worth stating plainly: cutting ads loses new-customer orders in proportion at today's CAC and leaves returning-customer orders alone. Without it, cutting ads would always look free. Money lines are rounded to whole cents and EBITDA is the sum of the rounded lines, so every bridge on the page adds up exactly.

**Partial month.** If the range stops before a month's last day, that month is flagged `partial` and its operating costs are prorated by elapsed days (`prorate`). Scenarios use complete months only.

**Ceilings, not silent zeros.** A month with no cost-sheet row for any category has `operatingCostsEntered: false`. A month with units sold on variants that have no unit cost has `unitsWithoutCost > 0`. Either makes `ebitdaIsCeiling: true`, and the agent must say so (same rule as `unitsWithoutCost` in unit economics).

**Who sees and edits.** Everyone with a connected brand can see `/ebitda`; only `gc_admin` and `gc_partner` can edit the cost sheet *(my call)*. An edit is a direct write stamped with `updatedBy` and `updatedAt`, not an approval card *(my call)*.

**Non-goals:** a QuickBooks or Xero connection; a CSV upload for the cost sheet (the parser in Task 1 is reusable for one later); tax, interest, depreciation or amortisation lines (EBITDA leaves them out by definition); forecasting beyond a baseline window (T16 owns that); any change to `get_unit_economics`. **Anti-goal:** the model inventing an operating cost or a rate; every such figure comes from a tool result.

## Decisions for Asim (my defaults, change any)

1. **Who sees `/ebitda`:** every role; GC roles edit. Alternative: GC roles only, like `/segments`.
2. **Edits skip the approval ledger.** The cost sheet is the brand's own planning input, not a write to Shopify. Alternative: a new action kind with an approval card.
3. **Independent of T16.** This plan does not wait for the forecasting ticket. It exports `DEFAULT_PRICE_ELASTICITY = -1.5`, the same default T16's `get_scenario` plans, so T16 can import it.
4. **Partial months prorate operating costs by elapsed days.** Alternative: show the full month's costs against part-month sales (looks worse, misleads more).
5. **Seeded costs are small** to match the seeded sales (see Design).

## Review Focus

The failure modes the spec implies but a happy-path test would miss, most likely first. Each has a test in the task named.

1. **No cost-sheet row for a month.** EBITDA must be flagged a ceiling and `operatingCosts` must be empty, never a silent $0 shown as a firm profit. Task 3 (tool), Task 5 (banner).
2. **A partial current month.** Half a month of sales against a full month of rent reads as a loss that is not real. Prorated and flagged. Task 3.
3. **Extreme levers.** `adSpendChange: -1` when every order is new, a zero-sales baseline, price −50%: no NaN, no negative orders, no division by zero. Tasks 2 and 4.
4. **A client viewer, or a request naming another tenant, editing the cost sheet.** 403 for the viewer; a body carrying `tenantId` is rejected; tenant A's edit never shows for tenant B. Task 6.
5. **Variants with no unit cost.** `unitsWithoutCost` carries through and the month is a ceiling. Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/ebitda/types.ts` (new) | `COST_CATEGORIES`, `CostCategory`, `CostAssumptions`, `DEFAULT_ASSUMPTIONS`, `CostSource` |
| `lib/db/schema.ts` (modify) | tables `operatingCosts`, `costAssumptions` |
| `lib/metrics/ebitda.ts` (new) | pure engine: `ebitdaLines`, `runScenario`, `volumeChangeForTarget`, `prorate`. No database or React imports (the scenario panel imports it in the browser) |
| `lib/ebitda/store.ts` (new) | reads and upserts of the two tables |
| `lib/ebitda/actuals.ts` (new) | `loadEbitdaMonths` (joins Shopify metrics, ad spend, cost sheet), `scenarioBaseOf` |
| `lib/ebitda/access.ts`, `lib/ebitda/costs-input.ts` (new) | who may edit; the zod schema of an edit |
| `lib/tools/ebitda.ts`, `lib/tools/ebitda-scenario.ts` (new) | the two agent tools |
| `scripts/fixtures/load-costs.ts` (new), `scripts/fixtures-load.ts`, `scripts/seed/generate.ts`, `scripts/seed/types.ts` (modify) | CSV parse, load and generation |
| `app/(app)/ebitda/` , `components/ebitda/` (new) | the page, bridge table, waterfall, receipts, scenario panel, cost sheet editor |
| `app/api/ebitda/costs/route.ts` (new) | the edit endpoint |
| `evals/ebitda-cases.ts` (new) | two eval cases |

---

### Task 1: Cost sheet tables, seed files and loader

**Files:**
- Modify: `lib/db/schema.ts`, `scripts/seed/generate.ts`, `scripts/seed/types.ts`, `scripts/fixtures-load.ts`
- Create: `lib/ebitda/types.ts`, `drizzle/0009_*.sql` (generated), `scripts/fixtures/load-costs.ts`, `fixtures/{solenne,tidepool}/costs.csv`, `fixtures/{solenne,tidepool}/cost-assumptions.csv`
- Test: `scripts/fixtures/load-costs.test.ts`, `scripts/seed/generate.test.ts`

**Interfaces:**
- Produces (`lib/ebitda/types.ts`):
  `COST_CATEGORIES = ["payroll","software","rent","contractors","other"] as const`; `type CostCategory`; `type CostSource = "fixture" | "manual"`; `interface CostAssumptions { cardFeeBps: number; cardFeeFixedCents: number; fulfilmentCentsPerOrder: number }`; `DEFAULT_ASSUMPTIONS: CostAssumptions = { cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 }`.
- Produces (`lib/db/schema.ts`): `operatingCosts` (`tenantId`, `month` text, `category` text, `amountCents` integer, `source` text `CostSource`, `updatedBy` text nullable, `updatedAt` timestamp default now; primary key `(tenantId, month, category)`); `costAssumptions` (`tenantId` primary key, `cardFeeBps`, `cardFeeFixedCents`, `fulfilmentCentsPerOrder` integers, `source`, `updatedBy`, `updatedAt`). Use `tenantRef()` as the existing tables do.
- Produces (`scripts/fixtures/load-costs.ts`): `parseCosts(text): CostRow[]` with `CostRow = { month: string; category: CostCategory; amountCents: number }`; `parseCostAssumptions(text): CostAssumptions`; `loadCosts(db, tenantId, csv): Promise<{ rows: number }>`; `loadCostAssumptions(db, tenantId, csv): Promise<void>`.
- Produces (`scripts/seed/generate.ts`): `operatingCostRows(store: StoreKey, asOf: string, storylines: boolean): CostRow[]`; `costAssumptionRows(store: StoreKey): { key: string; value: number }[]`.

File formats (same comment-line and header rules as `ad-spend.csv`): `costs.csv` is `month,category,amount` (amount in whole cents); `cost-assumptions.csv` is `key,value` with exactly `card_fee_bps`, `card_fee_fixed_cents`, `fulfilment_cents_per_order`.

Starting amounts, in cents *(my call; Task 3 tunes them)*:
- Solenne, from the store's first month to `asOf`'s month: `software` 25,000 a month, plus 2,500 more from each of 2026-01, 2026-04, 2026-07, 2026-10 (storylines only; without storylines it stays 25,000); `contractors` 30,000 a month from 2026-03 (storylines only); `other` 90,000 in 2026-06 only (storylines only).
- Tidepool: `software` 12,000 a month, nothing else.
- Both stores' assumptions: 290, 30, 450.

- [ ] **Step 1: Write the failing tests**

`scripts/fixtures/load-costs.test.ts` (use `createTestDb`, as `load-pace.test.ts` does):
```ts
it("parseCosts reads cents and skips the FICTIONAL SAMPLE comment line")   // "2026-03,software,27500" -> { month: "2026-03", category: "software", amountCents: 27500 }
it("parseCosts names the line for each bad row")        // category "bonus" -> /Line 3: "bonus" is not a cost category/; duplicate month+category; amount "12.5" or "-1"; month "2026-13"
it("parseCostAssumptions needs all three keys and rejects unknown ones")
it("loadCosts is repeatable: the same file twice leaves the same rows")
it("a reload never overwrites a cell a person edited")   // insert a row with source "manual", reload the file, the manual amount survives
```
`scripts/seed/generate.test.ts` (add):
```ts
it("operatingCostRows: one row per month and category from the store's first month to asOf's month, none after")
it("operatingCostRows is deterministic and every amount is a whole number of cents >= 0")
it("without storylines Solenne has software only, flat at 25000")
it("the checked-in costs.csv and cost-assumptions.csv match what the generator writes")   // same pattern the existing test uses for ad-spend.csv
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run scripts/fixtures/load-costs.test.ts scripts/seed/generate.test.ts`
Expected: FAIL (`load-costs` module and `operatingCostRows` not found).

- [ ] **Step 3: Implement**
  1. `lib/ebitda/types.ts` as above.
  2. The two tables in `lib/db/schema.ts`, then `npm run db:generate` and open the new `drizzle/0009_*.sql` to confirm it only creates two tables.
  3. `scripts/fixtures/load-costs.ts`: reuse `readRows` rules from `load-pace.ts` (export `readRows` from there rather than copying it). `loadCosts` upserts with `onConflictDoUpdate({ ..., setWhere: sql\`${operatingCosts.source} = 'fixture'\` })` so a manual cell is skipped.
  4. Generator functions and the writes in `main()` of `generate.ts`, beside the `ad-spend.csv` write.
  5. `scripts/fixtures-load.ts`: read both new files, validate them in the `--check` branch, load them in the write branch, and add `costs N rows` to both log lines.

- [ ] **Step 4: Generate the files and confirm nothing else moved**

Run: `npm run seed:generate`, then `git status --short fixtures/`
Expected: only the four new CSV files are untracked; `dataset.json`, `truth.json`, `plan.csv`, `ad-spend.csv` show no modification.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run scripts/fixtures/load-costs.test.ts scripts/seed/generate.test.ts`
Expected: PASS. Then `npm run fixtures:load -- --check`; expected output lists costs rows for both stores and "nothing written".

- [ ] **Step 6: Checkpoint**

Run: `npm run typecheck && npm run lint`. Expected: clean. Do not run `npm run db:migrate`; Asim is asked in Task 7.

---

### Task 2: The EBITDA engine (pure)

**Files:**
- Create: `lib/metrics/ebitda.ts`
- Test: `lib/metrics/ebitda.test.ts`

**Interfaces:**
- Consumes: `CostAssumptions` from `lib/ebitda/types.ts`.
- Produces:
```ts
export const DEFAULT_PRICE_ELASTICITY = -1.5;
export interface ScenarioBase { netSalesCents: number; orders: number; newCustomerOrders: number; costOfGoodsCents: number; adSpendCents: number; operatingCostsCents: number }
export interface EbitdaLines { netSalesCents: number; costOfGoodsCents: number; cardFeesCents: number; fulfilmentCents: number; adSpendCents: number; profitAfterVariableCostsCents: number; operatingCostsCents: number; ebitdaCents: number; ebitdaRate: number | null; profitAfterVariableCostsRate: number | null }
export interface Levers { priceChange?: number; adSpendChange?: number; unitCostChange?: number; volumeChange?: number; operatingCostChange?: number; elasticity?: number }
export interface ScenarioResult { baseline: EbitdaLines & { orders: number }; scenario: EbitdaLines & { orders: number }; deltaEbitdaCents: number; impacts: { lever: Exclude<keyof Levers, "elasticity">; deltaEbitdaCents: number }[] }
export function ebitdaLines(base: Pick<ScenarioBase, "netSalesCents" | "orders" | "costOfGoodsCents" | "adSpendCents" | "operatingCostsCents">, a: CostAssumptions): EbitdaLines
export function runScenario(base: ScenarioBase, a: CostAssumptions, levers: Levers): ScenarioResult
export function volumeChangeForTarget(base: ScenarioBase, a: CostAssumptions, levers: Levers, targetEbitdaCents: number): { volumeChange: number; ordersNeeded: number } | null
export function prorate(amountCents: number, elapsedDays: number, daysInMonth: number): number
```
Rules: money lines are `Math.round`ed and `ebitdaCents` is the sum of the rounded lines; rates are `null` when net sales is 0; `orders` in a result is rounded; `impacts` lists each lever that is set, applied alone, in the order of the `Levers` keys; `volumeChangeForTarget` is closed form (EBITDA is linear in the order factor with the other levers held), returns `null` when variable profit per unit of volume is ≤ 0 or the answer is below −1, and its `volumeChange` is relative to baseline orders with the other levers applied.

- [ ] **Step 1: Write the failing tests** (the hand-worked example: net sales 1,000,000, 100 orders of which 40 new-customer, cost of goods 400,000, ads 200,000, operating costs 250,000, assumptions 290 / 30 / 450)
```ts
const base = { netSalesCents: 1_000_000, orders: 100, newCustomerOrders: 40, costOfGoodsCents: 400_000, adSpendCents: 200_000, operatingCostsCents: 250_000 };
const a = { cardFeeBps: 290, cardFeeFixedCents: 30, fulfilmentCentsPerOrder: 450 };
it("baseline bridge", () => { /* cardFeesCents 32_000, fulfilmentCents 45_000, profitAfterVariableCostsCents 323_000, ebitdaCents 73_000, ebitdaRate 0.073 */ });
it("zero net sales gives null rates and no NaN", () => { /* netSales 0, orders 0, opex 50_000 -> ebitdaCents -50_000, ebitdaRate null */ });
it("ads -20%: lose 20% of the new-customer orders", () => { /* scenario.orders 92, ebitdaCents 71_160, deltaEbitdaCents -1_840 */ });
it("price +5% with the default elasticity", () => { /* orders 93 (92.5 rounded), netSalesCents 971_250, cardFeesCents 30_941, fulfilmentCents 41_625, ebitdaCents 78_684, delta +5_684 */ });
it("price +5% with elasticity 0", () => { /* ebitdaCents 121_550, delta +48_550 */ });
it("unit cost +8% -> 41_000; operating costs +10% -> 48_000", () => {});
it("extremes stay finite", () => { /* adSpendChange -1 with newCustomerOrders 100 of 100 orders: orders 0, netSalesCents 0, ebitdaCents -250_000; priceChange -0.5 and volumeChange -1: every number finite */ });
it("impacts are each lever alone, in key order", () => { /* levers { adSpendChange: -0.2, priceChange: 0.05 } -> [{ lever: "priceChange", ... }, { lever: "adSpendChange", ... }] in Levers key order: priceChange +5_684 then adSpendChange -1_840 */ });
it("volumeChangeForTarget", () => { /* target 150_000 with no levers -> ordersNeeded 115, volumeChange ~ 0.1472 (4 digits); null when costOfGoodsCents exceeds netSalesCents */ });
it("prorate", () => { /* prorate(300_000, 10, 30) === 100_000; prorate(250_000, 15, 31) === 120_968 */ });
```
Order inside `impacts` follows the declaration order of `Levers`: `priceChange`, `adSpendChange`, `unitCostChange`, `volumeChange`, `operatingCostChange`.

- [ ] **Step 2: Run to verify it fails**: `npx vitest run lib/metrics/ebitda.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the signatures above in `lib/metrics/ebitda.ts` using the formulas under "Scenario levers". Keep it free of any import except the `CostAssumptions` type.
- [ ] **Step 4: Run to verify it passes**: same command. Expected: PASS.
- [ ] **Step 5: Checkpoint**: `npm run typecheck && npm run lint`.

---

### Task 3: Actuals loader and the `get_ebitda` tool

**Files:**
- Create: `lib/ebitda/store.ts`, `lib/ebitda/actuals.ts`, `lib/tools/ebitda.ts`
- Modify: `lib/agent/tools.ts` (add `get_ebitda: getEbitdaTool as unknown as ToolDef` after `get_unit_economics`), `lib/agent/tool-labels.ts` (`get_ebitda: "EBITDA"`, `get_ebitda_scenario: "EBITDA what-if"`), `lib/agent/prompt.ts` (bullet below, after the unit-economics bullet), `lib/agent/checker.ts:27` (add `"ebitdaRate"`, `"profitAfterVariableCostsRate"`, `"cardFeeRate"` to `RATE_KEYS`)
- Test: `lib/ebitda/store.test.ts`, `lib/tools/ebitda.test.ts`

**Interfaces:**
- Consumes: `queryMetric` (metrics `net_sales`, `orders`, `new_customer_orders`, grouped by month), `loadLineMargins`, `adSpendByMonth` from `lib/metrics/cohorts.ts`, `loadWindow`, `todayFor`, `resolveRange`, `assertInWindow`, `periodShape`, `queryIdFor`, `requireConnectedShop` (all as `lib/tools/unit-economics.ts` uses them), `ebitdaLines` and `prorate` from Task 2, the loaders from Task 1.
- Produces (`lib/ebitda/store.ts`):
```ts
loadCostSheet(db: Db, tenantId: string, range: { from: string; to: string }): Promise<{ month: string; category: CostCategory; amountCents: number; source: CostSource }[]>   // range in YYYY-MM
loadAssumptions(db: Db, tenantId: string): Promise<{ assumptions: CostAssumptions; source: CostSource | "default" }>
upsertCostCell(db: Db, tenantId: string, userId: string, cell: { month: string; category: CostCategory; amountCents: number }): Promise<void>   // source "manual"
upsertAssumptions(db: Db, tenantId: string, userId: string, a: CostAssumptions): Promise<void>
```
- Produces (`lib/ebitda/actuals.ts`):
```ts
export interface EbitdaMonth extends EbitdaLines { month: string; partial: boolean; orders: number; newCustomerOrders: number; operatingCosts: { category: CostCategory; amountCents: number }[]; operatingCostsEntered: boolean; unitsWithoutCost: number; ebitdaIsCeiling: boolean }
export async function loadEbitdaMonths(ctx: TenantContext, range: { from: string; to: string }, deps: { db?: Db }): Promise<{ months: EbitdaMonth[]; assumptions: CostAssumptions; assumptionsSource: CostSource | "default"; operatingCostsSource: CostSource | "mixed" | "none"; range: { from: string; to: string }; asOf: string }>
```
`partial` is true when `range.to` (clipped to the data window) is before the month's last day; a partial month's operating costs are `prorate`d. `ebitdaIsCeiling` is `!operatingCostsEntered || unitsWithoutCost > 0`.
- Produces (`lib/tools/ebitda.ts`): `getEbitdaInputSchema = z.strictObject({ ...periodShape })`; `getEbitda(ctx, rawInput, deps = {}): Promise<ToolResult<EbitdaData>>`; `getEbitdaTool` in the `TOOL_DEFS` entry shape. `EbitdaData = { months: EbitdaMonth[]; total: EbitdaLines & { orders: number; unitsWithoutCost: number; ebitdaIsCeiling: boolean }; cardFeeRate: number; cardFeeFixedCents: number; fulfilmentCentsPerOrder: number; assumptionsSource: string; sources: Record<string, string> }`. Default range: the last 6 months through the latest synced day, as unit economics does. `definitions` carries the Design paragraph on each line, on partial months and on ceilings.

Prompt bullet (exact copy):
`- For EBITDA (profit after operating costs), use get_ebitda. Say which lines come from Shopify and which from the cost sheet, and that card fees and fulfilment are assumed rates. If ebitdaIsCeiling is true for a month, say EBITDA is a ceiling because operating costs were not entered or some units have no unit cost. A partial month has its operating costs prorated by days. Never work out an EBITDA, a margin or a cost yourself.`

- [ ] **Step 1: Write the failing tests.** Seed with `seedTwoStores(db)` as `lib/tools/bundles.test.ts` does, then `loadAdSpend`, `loadCosts` and `loadCostAssumptions` from the fixtures for each store, with `setTestNow("2026-11-02T12:00:00-05:00")`.
  `lib/ebitda/store.test.ts`:
```ts
it("loadAssumptions falls back to DEFAULT_ASSUMPTIONS with source 'default' when the tenant has no row")
it("upsertCostCell marks the cell manual and stamps updatedBy; tenant B's sheet is unchanged")
```
  `lib/tools/ebitda.test.ts`:
```ts
it("Solenne 2026-08 matches its sources")        // netSalesCents == truth.monthly["2026-08"].net_sales; adSpendCents == sum of that month in ad-spend.csv; operatingCostsCents == sum in costs.csv
it("every month's bridge adds up")                // profitAfterVariableCostsCents == netSales - cogs - fees - fulfilment - ads; ebitdaCents == that - operatingCostsCents
it("card fees and fulfilment use the assumptions row")   // cardFeesCents == Math.round(0.029 * netSalesCents + 30 * orders); fulfilmentCents == 450 * orders
it("a month with no cost-sheet rows is a ceiling")        // delete 2026-09's rows: operatingCostsEntered false, operatingCosts [], ebitdaIsCeiling true  [Review Focus 1]
it("a partial month prorates operating costs")            // input { from: "2026-10-01", to: "2026-10-15" }: October partial true, operatingCostsCents == prorate(full October sum, 15, 31)  [Review Focus 2]
it("units without a unit cost make the month a ceiling")  // set every variant's unitCostCents to null: unitsWithoutCost > 0, ebitdaIsCeiling true  [Review Focus 5]
it("no assumptions row uses the defaults and says so")    // assumptionsSource "default"
it("each brand sees only its own cost sheet")             // Tidepool's operatingCostsCents == its own csv sum, not Solenne's
it("rejects an unknown key such as tenantId")             // INVALID_INPUT
it("the sign mix is believable")                          // Solenne: at least one month with ebitdaCents > 0 and one < 0 over the full window; Tidepool: every month <= 0
it("the checker reads the rates as rates")                // ledgerFromToolResults over a result: ebitdaRate 0.073 is a rate entry worth 7.3, as bundles.test.ts checks other results
```
- [ ] **Step 2: Run to verify it fails**: `npx vitest run lib/ebitda/store.test.ts lib/tools/ebitda.test.ts`. Expected: FAIL (modules not found).
- [ ] **Step 3: Implement** `store.ts`, `actuals.ts`, `ebitda.ts` and the four edits above. In `actuals.ts`, take sales, orders and new-customer orders from one `queryMetric` call grouped by month, cost of goods and `unitsWithoutCost` from `loadLineMargins` exactly as `getUnitEconomics` does, and operating costs from `loadCostSheet`.
- [ ] **Step 4: Run to verify it passes**: same command. If "the sign mix is believable" fails, tune the amounts in `COST_PLAN` in `generate.ts`, rerun `npm run seed:generate` and `npx vitest run scripts/seed/generate.test.ts`; keep Solenne's July to October 2026 near break-even so a scenario can flip the sign.
- [ ] **Step 5: Checkpoint**: `npm run typecheck && npm run lint`.

---

### Task 4: The `get_ebitda_scenario` tool

**Files:**
- Create: `lib/tools/ebitda-scenario.ts`
- Modify: `lib/ebitda/actuals.ts` (add `scenarioBaseOf`), `lib/agent/tools.ts`, `lib/agent/prompt.ts`, `lib/agent/checker.ts:27` (add `"priceChange"`, `"adSpendChange"`, `"unitCostChange"`, `"volumeChange"`, `"operatingCostChange"` to `RATE_KEYS`)
- Test: `lib/tools/ebitda-scenario.test.ts`

**Interfaces:**
- Consumes: `loadEbitdaMonths`, `EbitdaMonth` (Task 3); `runScenario`, `volumeChangeForTarget`, `DEFAULT_PRICE_ELASTICITY`, `ScenarioBase` (Task 2).
- Produces (`actuals.ts`): `scenarioBaseOf(months: EbitdaMonth[]): ScenarioBase` (sums every field).
- Produces (`ebitda-scenario.ts`):
```ts
export const getEbitdaScenarioInputSchema = z.strictObject({
  months: z.number().int().min(1).max(12).optional(),             // the last N complete months; default 3
  priceChange: z.number().min(-0.5).max(1).optional(),
  adSpendChange: z.number().min(-1).max(2).optional(),
  unitCostChange: z.number().min(-0.5).max(1).optional(),
  volumeChange: z.number().min(-1).max(3).optional(),
  operatingCostChange: z.number().min(-1).max(2).optional(),
  elasticity: z.number().min(-5).max(0).optional(),
  targetEbitdaPerMonthCents: z.number().int().optional(),         // dollars x 100
})
getEbitdaScenario(ctx, rawInput, deps = {}): Promise<ToolResult<EbitdaScenarioData>>
```
`EbitdaScenarioData = { baselineMonths: string[]; baseline: ScenarioResult["baseline"]; scenario: ScenarioResult["scenario"]; deltaEbitdaCents: number; baselineEbitdaPerMonthCents: number; scenarioEbitdaPerMonthCents: number; priceChange?, adSpendChange?, unitCostChange?, volumeChange?, operatingCostChange? (echoed fractions); elasticity: number; elasticityIsDefault: boolean; baselineIsCeiling: boolean; impacts: ScenarioResult["impacts"]; target: { targetEbitdaPerMonthCents: number; volumeChange: number; ordersNeeded: number } | null }`. The baseline is complete months only: the last N months ending at the last complete month of the data; fewer than one complete month is `NO_DATA`. `definitions` states the ad-spend rule and the elasticity assumption in plain words. The tool description tells the model: quote the figures as written; say the elasticity and the new-customer rule are assumptions; if `baselineIsCeiling` is true, the scenario EBITDA is a ceiling too.

Prompt bullet (exact copy):
`- For what-if questions about profit (ads, price, product cost, volume, operating costs), use get_ebitda_scenario. Pass changes as fractions (a 20% cut is -0.2). Say that the price elasticity and the rule that fewer ads lose new-customer orders at today's CAC are assumptions, not data. If elasticityIsDefault is true, say the default was used. Never work out a scenario yourself.`

- [ ] **Step 1: Write the failing tests** (same seeding as Task 3)
```ts
it("no levers: delta 0 and the scenario equals the baseline")
it("the baseline is the sum of the last 3 complete months of get_ebitda")           // at 2026-11-02: Aug, Sep, Oct 2026
it("ads -20% cuts ad spend by a fifth and orders by 20% of the new-customer orders") // scenario.adSpendCents == Math.round(0.8 * baseline.adSpendCents); scenario.orders == Math.round(baseline.orders - 0.2 * newCustomerOrdersInBaseline)
it("elasticityIsDefault is true when omitted and false when given")
it("rejects elasticity 1, priceChange 2, months 13 and an unknown key such as tenantId")   // INVALID_INPUT  [Review Focus 3]
it("a target round-trips")      // Tidepool, targetEbitdaPerMonthCents 0: ordersNeeded > baseline orders; calling again with volumeChange: target.volumeChange gives scenarioEbitdaPerMonthCents within 200 cents of 0
it("an all-new-customer baseline with adSpendChange -1 stays finite")   // every number finite  [Review Focus 3]
it("the checker reads the lever echoes as rates")     // priceChange 0.05 is a rate entry worth 5
```
- [ ] **Step 2: Run to verify it fails**: `npx vitest run lib/tools/ebitda-scenario.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the tool and the edits; register as `get_ebitda_scenario`.
- [ ] **Step 4: Run to verify it passes**: same command, plus `npx vitest run lib/tools/tools.test.ts lib/agent` for the registry and checker tests. Expected: PASS.
- [ ] **Step 5: Checkpoint**: `npm run typecheck && npm run lint`.

---

### Task 5: The `/ebitda` page: bridge, waterfall and receipts

**Files:**
- Create: `app/(app)/ebitda/page.tsx`, `app/(app)/ebitda/loading.tsx`, `components/ebitda/bridge-table.tsx`, `components/ebitda/waterfall.tsx`, `components/ebitda/receipts.tsx`
- Modify: `components/shell/nav.tsx` (add `{ href: "/ebitda", label: "EBITDA", icon: Calculator }` to "Track", after Pace), `components/shell/command-palette.tsx`, `components/shell/nav.test.ts`
- Test: `app/(app)/ebitda/page.test.tsx`, `components/ebitda/waterfall.test.tsx`, `components/shell/nav.test.ts`

**Interfaces:**
- Consumes: `getEbitda` (Task 3) called from the server page with `getTenantContext()`, as `app/(app)/pace/page.tsx` does; `?month=YYYY-MM` selects the month shown in the waterfall (default: the latest complete month).
- Produces: `<Waterfall month={EbitdaMonth} />` (plain SVG like `components/pace/pace-chart.tsx`: colours from the theme variables, an `aria-label` carrying the figures, a "Show the numbers" table underneath); `<BridgeTable months={EbitdaMonth[]} selected={string} />` (a row per month, ceilings marked, partial months marked); `<Receipts data={EbitdaData} />` (each line with its source wording from the Design table, the assumed rates and who last edited the cost sheet).

Behaviour: a disconnected store shows `ErrorBanner` with `STORE_DISCONNECTED`; a month with `ebitdaIsCeiling` shows a notice saying why ("No operating costs entered for this month" or "N units have no unit cost"); a client viewer sees the page (unlike `/segments`).

- [ ] **Step 1: Write the failing tests**
```ts
it("waterfall renders net sales, each cost, profit after variable costs, operating costs and EBITDA, and the table repeats them")
it("waterfall copes with a negative EBITDA and with a month with no sales (no NaN in the markup)")
it("page: a disconnected store shows the STORE_DISCONNECTED banner")
it("page: a client viewer sees the bridge (not a 'Growth Capital roles only' screen)")
it("page: a ceiling month shows its notice; a complete month does not")     // [Review Focus 1]
it("nav: /ebitda appears for every role, after /pace")   // update the two hard-coded href lists in nav.test.ts
```
- [ ] **Step 2: Run to verify it fails**: `npx vitest run "app/(app)/ebitda/page.test.tsx" components/ebitda components/shell/nav.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the page and three components, following `app/(app)/segments/page.test.tsx` for how a page is tested and `components/pace/pace-chart.tsx` for the SVG conventions (theme variables, no hard-coded colours, readable on a phone). Add the nav and palette entries.
- [ ] **Step 4: Run to verify it passes**: same command. Expected: PASS.
- [ ] **Step 5: Checkpoint**: `npm run typecheck && npm run lint`.

---

### Task 6: Scenario panel and the editable cost sheet

**Files:**
- Create: `components/ebitda/scenario-panel.tsx`, `components/ebitda/cost-sheet.tsx`, `lib/ebitda/access.ts`, `lib/ebitda/costs-input.ts`, `app/api/ebitda/costs/route.ts`
- Modify: `app/(app)/ebitda/page.tsx` (mount both)
- Test: `components/ebitda/scenario-panel.test.tsx`, `components/ebitda/cost-sheet.test.tsx`, `app/api/ebitda/costs/route.test.ts`

**Interfaces:**
- Consumes: `runScenario`, `volumeChangeForTarget`, `DEFAULT_PRICE_ELASTICITY` (Task 2, imported in the browser); `scenarioBaseOf`, `loadEbitdaMonths` (Tasks 3 and 4); `upsertCostCell`, `upsertAssumptions` (Task 3); `withTenant`, `readJson`, `json` (`lib/api/respond.ts`).
- Produces:
```ts
// lib/ebitda/access.ts
export const canEditCostSheet = (ctx: Pick<TenantContext, "role">): boolean   // gc_admin or gc_partner
export function assertCanEditCostSheet(ctx: Pick<TenantContext, "role">): void  // throws AppError("FORBIDDEN"), modelled on lib/call-notes/access.ts
// lib/ebitda/costs-input.ts
export const costEditSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("cell"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), category: z.enum(COST_CATEGORIES), amountCents: z.number().int().min(0).max(100_000_000) }),
  z.strictObject({ kind: z.literal("assumptions"), cardFeeBps: z.number().int().min(0).max(1000), cardFeeFixedCents: z.number().int().min(0).max(500), fulfilmentCentsPerOrder: z.number().int().min(0).max(10_000) }),
])
// app/api/ebitda/costs/route.ts
export const PUT   // withTenant -> assertCanEditCostSheet(ctx) before reading the body -> readJson -> costEditSchema -> upsert with ctx.userId -> json({ ok: true })
// components
<ScenarioPanel base={ScenarioBase} assumptions={CostAssumptions} months={number} />
<CostSheet months={string[]} rows={...} assumptions={CostAssumptions} canEdit={boolean} />
```
A `cell` month outside the data window (before the first synced month or after the current month) is `INVALID_INPUT`. After a successful save the sheet calls `router.refresh()`. The panel has five sliders (the levers), an elasticity field marked "assumption (default −1.5)", a "Target EBITDA per month" field that shows `volumeChangeForTarget`'s answer ("about 115 orders instead of 100"), a reset button, and a line beneath saying the ad-spend rule in plain words.

- [ ] **Step 1: Write the failing tests**
```ts
// route.test.ts (createTestDb + seedTwoStores; call PUT with a Request and an injected ctx as other route tests do)
it("a gc_partner edit changes the next getEbitda for that month and marks the cell manual")
it("a client_viewer gets 403 and nothing is written")                         // [Review Focus 4]
it("a body carrying tenantId, an unknown category, a negative amount or a decimal amount is rejected")  // 400 INVALID_INPUT  [Review Focus 4]
it("an edit for Solenne never changes Tidepool's figures")                    // [Review Focus 4]
it("a month outside the data window is rejected")
it("saving assumptions changes cardFeesCents on the next getEbitda")
// scenario-panel.test.tsx
it("moving the ad slider to -20% shows the same delta as runScenario for those inputs")
it("reset returns every lever to zero and the delta to 0")
it("labels the elasticity as an assumption and the default as the default")
// cost-sheet.test.tsx
it("a viewer sees the sheet read-only; a GC role sees editable cells")
it("an empty month is shown as 'not entered', not as $0")                     // [Review Focus 1]
```
- [ ] **Step 2: Run to verify it fails**: `npx vitest run app/api/ebitda components/ebitda/scenario-panel.test.tsx components/ebitda/cost-sheet.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above. The page builds the panel's `base` with `scenarioBaseOf` over the last three complete months it already loaded. Cost sheet cells save on blur with one `PUT` each, as dollars in the UI and cents on the wire.
- [ ] **Step 4: Run to verify it passes**: same command. Expected: PASS.
- [ ] **Step 5: Checkpoint**: `npm run typecheck && npm run lint`.

---

### Task 7: Evals, docs and the final check

**Files:**
- Create: `evals/ebitda-cases.ts`, `evals/ebitda-cases.test.ts`
- Modify: `evals/cases.ts` (register the two cases the way `t18-cases` is registered), `docs/build-plan.md` (a T22 section), `docs/priorities.md` (a row and a "Changes made" line), `docs/feature-map.md` (a row under the extras, extending 25 and 32), `README.md` (an EBITDA section and glossary entries for EBITDA, cost sheet and profit after variable costs)

**Interfaces:**
- Consumes: the case shape in `evals/t12-cases.ts` (`id`, `category`, `store`, `now`, `question`, `expect(env) => { tools, numbers?, mentions?, avoid?, verified }`); `parseCosts` and `readFixtureFile` for the expected figures.
- Produces: two cases.
  1. `ebitda-solenne-august` (category `ebitda`, `now: "2026-11-02T12:00:00-05:00"`): "What was Solenne's EBITDA in August 2026, and what is it made of?" Expects tool `get_ebitda`; a number check on August's operating costs from `costs.csv`; a mention that card fees and fulfilment are assumed rates; `verified: true`.
  2. `ebitda-ads-cut` (same store and time): "What happens to our profit if we cut ad spend by 20%?" Expects tool `get_ebitda_scenario`; a mention that fewer ads lose new-customer orders or that it is an assumption; avoids claiming the cut is free ("no impact", "costs nothing"); `verified: true`.

- [ ] **Step 1: Write the failing test** `evals/ebitda-cases.test.ts`: both case ids are registered, each has a question, a store, a fixed `now`, and `expect` returns the tool names above for the fixture env (same style as `evals/t18-cases.test.ts`).
- [ ] **Step 2: Run to verify it fails**: `npx vitest run evals/ebitda-cases.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the cases and the docs edits. Docs state the ticket in the repo's own style: what is built, what is a design note (QuickBooks or Xero, CSV upload), and the honest limits (assumed rates, small seeded numbers, the ad-spend rule, today's unit cost).
- [ ] **Step 4: Run to verify it passes**: same command. Expected: PASS.
- [ ] **Step 5: Final check, in this order**
  1. `npm run typecheck && npm run lint`.
  2. `npm test` (the one full run for the ticket, about a minute). Expected: all pass.
  3. **Ask Asim**, then `npm run db:migrate` (additive: two new tables) and `npm run fixtures:load -- --store both`.
  4. **Tell Asim the cost first** (two cases, about $0.20 to $0.30), then `npm run eval`. Report each case's result honestly, including a failure.
  5. Only if Asim asks, open `/ebitda` in the browser for a look.
  6. Stop. List the changed files and suggest a commit message with no Co-Authored-By line, for example: `feat: EBITDA calculator: seeded cost sheet, bridge and waterfall page, what-if scenarios, and two agent tools`.

---

## Self-Review

- **Design coverage:** the bridge and receipts (Tasks 3, 5), the seeded and editable cost sheet (Tasks 1, 6), the agent tool and what-ifs (Tasks 3, 4), the backsolve from a target (Tasks 2, 4, 6), ceilings and partial months (Tasks 2, 3, 5), roles (Task 6), evals and docs (Task 7). Every Decision for Asim is visible in a task.
- **Names match across tasks:** `EbitdaLines`, `ScenarioBase`, `Levers`, `ScenarioResult`, `runScenario`, `volumeChangeForTarget`, `prorate` (Task 2) are the names Tasks 3, 4 and 6 use; `EbitdaMonth`, `loadEbitdaMonths`, `scenarioBaseOf` (Tasks 3 and 4) are the names Tasks 5 and 6 use; `CostAssumptions` and `DEFAULT_ASSUMPTIONS` (Task 1) flow into all.
- **Known soft spot:** the seeded amounts are starting values. If the sign-mix test in Task 3 keeps failing, the fix is in `COST_PLAN`, not in the engine.
