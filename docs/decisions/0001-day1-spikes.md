# 0001: Day-1 spikes and the T1 pilot

*2026-10-31. Records what the pilot and spike (a) showed, and what T2 and T3 should do about it.*

## Spike (a): can orders backdated more than 60 days be read with `read_orders` alone?

**Yes, today. Not for long.**

- Run as the product app (read scopes only, no `read_all_orders`) against Solenne after the pilot: all 22 pilot orders were visible, every one with a `processedAt` in September 2025, more than 60 days before the as-of date 2026-10-31.
- They are visible because Shopify's 60-day window counts an order's **`createdAt`**, and seeded orders get the import time as `createdAt` (2026-10-31, for the pilot). The historical date lives only in `processedAt`.
- Script: `npm run seed:spike-a -- --store solenne` (read-only).

**What this doesn't show.** It doesn't prove the cut-off: the orders are 0 days old by `createdAt`. Shopify documents that, without `read_all_orders`, an app sees only orders created in the last 60 days. So every seeded order should stop being readable by the product app about **60 days after it was imported**, which is around **2026-12-30** for the first load.

**Consequences for T2 and T3**
- The sync fills Postgres on connect, so synced data stays usable. A **resync after about 2026-12-30 must never delete or overwrite rows just because Shopify no longer returns them.** Upsert only, and add a test.
- Webhook orders and any top-up orders are new, so they are unaffected.
- A reviewer who connects a store after that date would sync an empty history. Mention it in the README, and use `read_all_orders` if Shopify allows the request.
- `read_all_orders` can't be requested from the dashboard until a distribution method is chosen (Partner Dashboard: "Choose your distribution model before requesting"). That choice is one-way, so it stays deferred.

## T0 items the pilot resolved

- **Protected customer data for the seeder.** The first pilot run was refused ("This app is not approved to access the Customer object"), with orders and customers denied on reads too. The seeder had been left unset in T0. Selecting the Level 1 data use in the Partner Dashboard (no fields; stays a Draft, since dev-store apps need no review) fixed it.
- **Level 2 and custom distribution weren't needed.** Customers are created from an `@example.com` address built from the customer id, with no name, phone or address, and the product app reads them at Level 1.

## The pilot

Solenne's first 20 orders by date, plus the first 2 refunded orders (O_00042 and O_00046), their customers, the full catalog and the stock levels:

| Loaded | Count |
|---|---|
| Locations, collections, products (63 variants), discount codes | 2, 6, 28, 12 |
| Customers | 22 |
| Orders | 22 |
| Refunds | 4 |

`npm run seed:pilot-check -- --store solenne --limit 20` read everything back through the Admin API and compared each order's and refund's `processedAt`, line prices, quantities, discount total, shipping and tags with the dataset: **22 of 22 orders and 4 of 4 refunds match.**

**Throttling.** Order O_00042 came back with the user error "Too many attempts. Please try again later." even though calls were spaced 12 seconds apart, so Shopify's limit on creating orders is stricter than "5 a minute". The loader treated it as a hard failure and counted it toward its abort limit. It now waits 60 seconds and retries the same order, up to 5 times, and only reports a failure if the limit never clears (two tests cover this). Expect the full load to run a little longer than the planned 3.5 hours.

## Not done in T1

- `topup.ts` isn't in T1's ticket and isn't built. The fixtures are pinned to as-of 2026-10-31.
- Spike (b), whether `read_all_orders` has been approved, and spike (c), the ShopifyQL comparison, aren't in this ticket.
