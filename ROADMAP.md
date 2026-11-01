# Roadmap

What is built, what was left out on purpose, what production would add, and what is known to be limited. Status as of 2026-11-02. The build order and reasons are in [docs/priorities.md](docs/priorities.md), the steps and status notes per ticket in [docs/build-plan.md](docs/build-plan.md), and how to operate the app in [docs/runbook.md](docs/runbook.md).

## Built

| Ticket | What | Status |
|---|---|---|
| T0 | Accounts, apps, stores, keys | Done. Departures: custom distribution left unchosen, `read_all_orders` not requested, a shared Bedrock key reused, no AWS budget alert |
| T1 | Demo data and fixtures | Done. Both dev stores loaded (Solenne about 1,000 orders, Tidepool about 100), with `truth.json` and every fixture |
| T2 | Platform | Done. Next.js on Vercel, Clerk, Neon, Shopify OAuth, verified webhooks |
| T3 | Sync, metrics, tools | Built. Paged sync, 11 metrics, 6 tools, nightly refresh, `orders/create`. `reconcile:truth` finds no differences on either store. A new order arriving by webhook is not recorded as checked |
| T4 | Agent and chat | Built. Number checker, spend cap, audit log, 8 suggested questions, checked live on the Vercel URL |
| T5 | Core ship | Deferred by Asim, see below |
| T6 | Pace | Done and checked live. Plan vs actual, generated views, pinned views, saved threads, confirmed notes, ad spend (MER, CAC). 3 of 3 evals pass |
| T7 | Why | Code built, tests pass, not checked live. The single-vs-multi-agent comparison and the five "why" evals have not been run |
| T8 | Plan in, Act | Code built, not checked live. SOW and plan-sheet upload with review, and three approved writes (Metric Target, annotation, discount off). Needs `shopify app deploy` and an approval in each store |
| T9 | Landing pages | Built and checked live. Copy-only drafts, server-built Liquid, Theme Check, approval card and action ledger. Theme writes need Shopify's exemption (below); `npm run landing:push` finishes an approved page through the Shopify CLI |
| T10 | Portfolio and Monday brief | In-app part built, not checked live. Slack and MCP are deferred |
| T11 | Final ship | Closed 2026-11-01 for the first ship: full suite, 24 evals (22 of 24 on Sonnet 4.6), three independent reviews with their fixes, README, runbook, both reviewer logins checked on the live site. Asim records the final Loom when the deliverables are sent. T12 to T15 came after it |
| T12 | Gross margin, repeat rate, zero-sales days, cohort grids, payback, "need $X a day" | Built 2026-11-01. New tools `get_cohorts`, `get_unit_economics`, `get_zero_sales_days`; a cohort heat grid in chat; "Need $X a day" on Pace. Cohort grid checked live 2026-11-02 |
| T13 | Invoices, document questions, call notes | Built 2026-11-01. A supplier invoice becomes five approved unit-cost updates, checked live end to end on Solenne (real Shopify writes). A call note becomes plan changes and action items, checked live 2026-11-02; the check found a dropped action item, fixed the same day |
| T14 | Data-health checks and growth audit | Built 2026-11-01. `/audit` runs four fixed checks and the model writes them up; checked live on Tidepool 2026-11-02 |
| T15 | Langfuse traces, fallback model, evals | Built. Traces are live on the deployed app (2026-11-02). The fallback decision (`lib/agent/fallback.ts`) has unit tests; the full run-level path has no test and has not been seen in a real outage. Evals run locally, not in CI, by choice (below) |
| T18 | Playbooks | Built 2026-11-02. `/playbooks` (GC roles only) runs a Black Friday review, a retention check or a monthly business review through the agent loop, so the number checker runs, and stores each run per brand. One paid call per run, one run per brand per playbook per 10 minutes. The eval case (October's review names the budget cut, S9) passes, and a retention case guards the figures. Both were run once, not as part of the full set. The Slack bot is T18b |
| T17 | Growth analyses | Built 2026-11-02. Promo post-mortem (`get_promo_postmortem`: extra sales against sales pulled forward, and the repeat rate of the promo's customers; both eval cases run once live, Black Friday 12 of 12 and VIPGLOW25 12 of 13 before a number-checker fix). Merchandising (`get_bundle_candidates`, `get_launch_curves`). Retention segments (`get_customer_segments`: RFM scores, lifetime value, churn risk, four segments), the `/segments` page (GC roles only) and a Klaviyo CSV of pseudonymous ids. The `segment_create` write to Shopify is tested against a fake client only: it needs the `write_customers` scope and a deploy before it can run live, and until then approving fails safely. The three new eval cases are written, not run (paid) |

## Deferred on purpose

- **T5, core ship.** Asim put T6 first on 2026-10-31. Still owed: the 15 eval cases (8 exist and `npm run eval` works), the README (none yet), and the backup Loom. T11 picks them up.
- **Slack posting (T10, now T10b).** No webhook is set up. An approved brief is logged, not posted. Slack goes in `lib/briefs/deliver.ts`, after the approval check.
- **MCP server (T10).** `/api/mcp`, token-per-org access and the MCP tenant test are not built, so Liam cannot reach the read tools from Claude yet.
- **Theme writes (T9).** Shopify lets an app write theme files only with an exemption. Without it, the approval returns "not written" and `npm run landing:push -- <action id>` finishes the page through the Shopify CLI. Next: request the exemption, or use a Theme Access password so a server job can push.
- **`read_all_orders`.** Requesting it means choosing a distribution model, which cannot be undone. Left until needed (see limitations).
- **Follow-ups from T12 to T15 ([#22](https://github.com/asimniazi63/growthcap/issues/22)).** Those four tickets were closed on 2026-11-02 with these items moved out: the live check of "Need $X a day" on November data, one saved full eval run (three cases have never run), the audit running by itself when a store connects, Opus 5.5 as the fallback model with a whole-path test, and evals in CI (descoped: they run locally and the scoreboard is committed).
- **Single-vs-multi-agent comparison (T7).** The eval switch exists (`AGENT_SINGLE_AGENT`). The run and the table do not.

## Not started: extras T16, T18b and T19

Each is a feature from [docs/feature-map.md](docs/feature-map.md) the brief does not ask for. T12 to T15, T17 and T18 are built (above). The rest run in this order, and nothing outside a ticket gets built without Asim's go-ahead. T10b ([#21](https://github.com/asimniazi63/growthcap/issues/21)), Slack posting of the Monday brief, stays deferred (above).

| Ticket | Idea |
|---|---|
| T16 | Forecast, what-if scenarios, inventory runway, Black Friday war room |
| T18b | A Slack bot that answers questions and runs playbooks (split from T18 on 2026-11-02) |
| T19 | About 3,000 orders with the two subtle storylines (S1, S2) and the weak BFCM cohort, in fresh stores |

If time runs short, cut from the bottom: T19 back to T16, then T10, T8 part D, T7, T9, T8 part C and T6. Nothing in T0 to T5 is cut.

**Not built** ([priorities.md](docs/priorities.md)): benchmarks across clients (Shopify's API terms bar them), a Sidekick extension (needs an embedded app), production token handling (designed, not needed for a demo), a ShopifyQL check of the seeded data (needs Level 2 customer data), and two lower-ranked ideas (a creative-to-commerce loop, an AI-shopping readiness audit).

**Ideas with no ticket** (from the product plan's roadmap): auditing a prospect's store for the waitlist (T14 audits a connected store; a prospect needs a public app), first-purchase analysis for creative briefs and email timing, P&L per creator code, and an "Oasis Lite" tier for brands under $1M.

## What production would add

The full design is in [docs/production/product-plan.md](docs/production/product-plan.md) and [docs/production/implementation-plan.md](docs/production/implementation-plan.md). In short:

- A new public Shopify app, expiring offline tokens, and Shopify's approval for `read_all_orders` and protected customer data.
- Row-level security in Postgres, one tenant source per entry point, and the OAuth install bound to the tenant that started it.
- Webhooks acknowledged fast and processed through a queue, every change webhook, and a 15-minute reconcile instead of a nightly sync.
- Compliance webhooks acted on within Shopify's 30 days, keyed pseudonyms, and an audit table for people's actions.
- A Clerk production instance with MFA, separate environments, backups, alerting and measured targets.
- Failover to a second model provider, a spend ledger that reserves cost before a run, and evals as a CI gate with repeated trials.

## Known limitations

- **Models.** Claude Sonnet 4.6 is the default; Kimi K3, MiniMax M2.5 and Devstral 2 are selectable. The Claude 5.5 models are still not approved for the account (AWS support case opened 2026-10-31); `BEDROCK_CLAUDE_ENABLED=true` switches them on and makes them the defaults once they are.
- **Demo clock.** When the newest order is over 36 hours old, "today" becomes the day after it. On Solenne "last month" is October and "this month" has no data until `npm run seed:topup` adds complete November days. Tidepool's data ends 2026-10-26, so there "last month" stays September. The chat says so in a banner. Evals pin the clock.
- **Month-end edge.** On the last day of a month the chat's "this month" covers the whole month, so a gauge shows no estimate. `/pace` counts complete days only.
- **One currency per brand.** Money is stored in each shop's own currency and nothing converts. The portfolio ranks brands by gap in cents, which is only meaningful when they share a currency. Both demo stores are USD. Multiple currencies are a non-goal.
- **60-day order window.** Without `read_all_orders`, seeded orders stop being readable about 2026-12-30, and a store connected after that would sync no history. Rows already synced stay, because sync is upsert only.
- **Upsert only.** A line removed from an edited order, or a refund Shopify later deletes, stays in the synced copy.
- **Webhook gaps.** The shop-domain header is not covered by Shopify's HMAC. Two deliveries at the same instant can both run, which is safe because the write is an upsert.
- **Sync size.** Paged queries, not a bulk export. A sync must finish inside a 300-second function. A full Solenne sync (about 1,000 orders) works; a store of 100,000 orders would not.
- **No location names.** The app does not hold `read_locations`, so stock is by location id only.
- **Plan is monthly.** It holds five metrics by month. Refund-rate and quarter-total targets from a SOW come back as "not applied". The month-end estimate has no range or backtest.
- **Metrics.** `gross_margin` (at today's unit cost, not the cost when the order was made), `repeat_rate` and `zero_sales_days` are built. A `collection` dimension is not. Definitions have not been compared with Shopify Analytics.
- **`DATA_STALE`** is defined and has banner text, but nothing raises it.
- **Tracing and fallback.** Runs are logged in `agent_runs` and `agent_steps`. Langfuse tracing is opt-in (three variables) and records no prompts or answers. A turn moves once to a fallback model when the chat model fails before any text streams; the decision has unit tests, the full run-level path has no test, and it has not been seen in a real outage.
- **Evals are not in CI.** They run locally (`npm run eval`) and the scoreboard in `docs/evals/` is committed. `.github/workflows/evals.yml` is manual-only and has no secrets set.
- **Spend cap.** One value for every brand.
- **Theme Check** has not been run on the deployed route.
- **Shared Bedrock key.** The key also serves another project and its policy allows more than invoking models. Production would use short-lived credentials.
- **Wrong time of day.** Solenne's last four orders (O_01021 to O_01024) carry the load time, not the planned one. Daily totals are unaffected.
- **Migrations** run by hand (`npm run db:migrate`), not on deploy.
