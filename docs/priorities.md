# Priorities

*Sets the build order. Each ticket's steps are in [build-plan.md](build-plan.md), and each ticket is also a GitHub issue. Updated 2026-10-31.*

## What the brief asks for

The brief requires three things and a delivery format. Everything else, including its four stretch ideas, is optional.

| Brief item | Smallest thing that satisfies it | Tickets |
|---|---|---|
| Test Shopify app | An app installed on the dev store, with read access to its data | T0, T2 |
| Test dev store | A dev store with data in it | T0, T1 |
| AI agent that can query this data on demand | A chat that answers questions by calling tools against the store's data | T3, T4 |
| GitHub repo + Loom | The repo with a README, and a demo video | T5 |

## Priority order

Finish each ticket before starting the next. T11 always runs last, whatever has been built.

| # | Tier | Ticket | Issue | Why |
|---|---|---|---|---|
| 1 | Required | T0: Accounts, apps, stores and keys | #1 | Brief items 1 and 2 |
| 2 | Required | T1: Demo data and fixtures | #2 | Brief item 2 |
| 3 | Required | T2: Platform | #3 | Brief item 1 |
| 4 | Required | T3: Sync, metrics and tools, including the `orders/create` webhook | #4 | Brief item 3. The webhook shows a new order arriving, which is the clearest proof of "on demand" |
| 5 | Required | T4: Agent and chat | #5 | Brief item 3 |
| 6 | Required | T5: Core ship (**deferred by Asim, 2026-10-31: T6 runs first**) | #6 | Delivery. From here on there's always a complete submission. Still owed: the 15 evals and `npm run eval`, README v1, the backup Loom. T11 picks up whatever is left |
| 7 | Their ideas | T6: Pace (generative UI, memory, ad spend) | #7 | Stretch ideas 1 and 4, and the most visible in a Loom |
| 8 | Their ideas | T8 part C: Plan in (SOW parsing) | #9 | Stretch idea 2. The SOW feeds the plan that Pace uses |
| 9 | Their ideas | T9: Liquid landing pages | #10 | Stretch idea 3 |
| 10 | Beyond their list | T7: Why (multi-agent) | #8 | Explains gaps; also adds data sources (calendar, call notes) |
| 11 | Beyond their list | T8 part D: Act with approval | #9 | Approved writes to Shopify |
| 12 | Beyond their list | T10: Portfolio, Monday brief, MCP | #11 | Oasis extras |
| 13 | Extras | T12: Deeper metrics: margin, cohorts and pace targets | #13 | Extends their ideas 1 and 4 (features 21, 25, 28) |
| 14 | Extras | T13: Documents in: supplier invoices and call notes | #14 | Extends their idea 2 (features 23, 27, 41) |
| 15 | Extras | T14: Store checks: data health and growth audit | #15 | The ⭐ growth audit (features 30, 40) |
| 16 | Extras | T15: Ops: traces, model fallback, evals in CI | #16 | Quality and reliability (features 15, 20, 44) |
| 17 | Extras | T16: Forecasting: scenarios, runway, Black Friday war room | #17 | Features 31, 32, 33 |
| 18 | Extras | T17: Growth analyses: post-mortems, merchandising, segments (**slice 1, promo post-mortems, built 2026-11-02; its two eval cases ran once live, BFCM25 12 of 12 and VIPGLOW25 12 of 13 before a checker fix. Slice 2, merchandising and retention segments (bundles, launch curves, the `/segments` page, the Klaviyo CSV), is built; the Shopify segment write is tested against a fake client only and needs a scope and a deploy before it can run live; its three eval cases are written, not run (paid)**) | #18 | Features 34, 35, 36 |
| 19 | Extras | T18: Playbooks (**built 2026-11-02; October review eval passes, 8 of 8**) | #19 | Feature 38 |
| 19b | Extras | T18b: Slack bot | #23 | Feature 39 (the Slack part). Needs a Slack app from Asim. Numbered 19b so the later priorities keep their numbers |
| 20 | Extras | T19: Fuller dataset | #20 | Features 3, 5. It replaces the demo data, so it runs last, with a day to spare |
| 21 | Last, always | T11: Final ship | #12 | Whatever is built gets its evals, docs and the final Loom |

**If time runs short,** cut from the bottom: T19 back to T12, then T10, then T8 part D, then T7, then T9, then T8 part C, then T6. Nothing in T0–T5 is cut.

## Changes made while building

- **2026-10-31, Asim:** T0, T1 and T2 are closed on GitHub. T3 stays open until the `orders/create` check is done; T4 stays open until the suggested questions are checked on the Vercel URL after the latest fixes are deployed. T5 is deferred and T6 ran next (done 2026-10-31, with a small `npm run eval` for its three cases). Until T5 is built there is no `npm run eval`, so T6's three eval cases are listed in its ticket and written when the harness exists.

- **2026-10-31, Asim:** T7, T8 (C and D), T9 and T10 were built together in one parallel pass, with full testing, evals and live checks left to T11. Slack posting and MCP (T10) are deferred. T5's owed items fold into T11.

- **2026-11-02, Asim:** T18 is split in two. T18 (#19) keeps the playbooks; the Slack bot is T18b (#23), numbered 19b so the later priorities keep their numbers. T18b needs T18 and a Slack app from Asim, and can share that app with T10b (#21). T12 to T15 were closed the same day, with their follow-ups in #22.

- **2026-11-02:** T18's playbooks are not a separate runner. Each one is a fixed question, written on the server, that goes through the shared agent loop. The "saved sequence of tool calls" is the list of tools that question asks for, and the number checker verifies the write-up as it does for chat.

## What this order changes in the build plan

- T3's `orders/create` webhook is required, not "if time allows".
- T8 is done in two passes: part C at priority 8, part D at priority 11.
- T9 runs before T8 part D, so T9 builds the approval card and the action ledger, and T8 part D reuses them.
- T10's top driver per brand comes from T7. If T7 is cut, the portfolio ranks brands by gap to plan only.
- The extras run after T10 and before T11. Several build on T12's metrics and T9's approval card, so T12 comes first among them.

## Kept in the required tickets, though the brief doesn't ask for them

These stay because they're where the thinking shows.

| Part | Why it stays |
|---|---|
| Seeded storylines instead of Shopify's generated data | They give the agent real things to find, and they're the ground truth for the evals |
| Number checker and provenance | Every number can be traced back to a query |
| Metric definitions | Every answer says what its numbers mean |
| 15 evals | Quality is measured, not claimed |
| Postgres sync and metric layer | Avoids Shopify's query-cost limits, and makes the numbers testable |
| Two brands with roles | It's how an agency platform like Oasis works |
| Decisions and production gaps in the README | The trade-offs are written down |

## Feature map coverage

Every feature in [feature-map.md](feature-map.md) now has a ticket, except those listed under "Not built" below.

- **Folded into existing tickets, at no extra time:** feature 2, the Plus plan, is in T0. Feature 24, Shopify CLI with the Theme Access app as the fallback for theme writes, is in T9.
- **New tickets T12–T19** cover the rest, as in the priority order above.

**Not built**

| Feature | What | Why |
|---|---|---|
| 37 | Anonymized benchmarks across clients (part of portfolio mode) | Shopify's API Terms bar competitive benchmarking |
| 4 | Checking the seeded data against ShopifyQL | Needs Level 2 customer data; `reconcile:truth` already checks the synced numbers |
| 39 | A Sidekick extension (part of "use it anywhere") | Needs an embedded app, which is a non-goal |
| 43 | Production token handling | Designed in [production/](production/); a demo doesn't need it |
| 46, 47 | Creative-to-commerce loop; AI-shopping readiness audit | Ranked lower in the feature map |
