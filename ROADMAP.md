# Roadmap

What is built, what was left out on purpose, what production would add, and what is known to be limited. Status as of 2026-10-31. The build order and reasons are in [docs/priorities.md](docs/priorities.md), the steps and status notes per ticket in [docs/build-plan.md](docs/build-plan.md), and how to operate the app in [docs/runbook.md](docs/runbook.md).

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
| T9 | Landing pages | Code built, not checked live. Copy-only drafts, server-built Liquid, Theme Check, approval card and action ledger. Theme writes need Shopify's exemption (below) |
| T10 | Portfolio and Monday brief | In-app part built, not checked live. Slack and MCP are deferred |
| T11 | Final ship | Not started. Always last |

## Deferred on purpose

- **T5, core ship.** Asim put T6 first on 2026-10-31. Still owed: the 15 eval cases (8 exist and `npm run eval` works), the README (none yet), and the backup Loom. T11 picks them up.
- **Slack posting (T10).** No webhook is set up. An approved brief is logged, not posted. Slack goes in `lib/briefs/deliver.ts`, after the approval check.
- **MCP server (T10).** `/api/mcp`, token-per-org access and the MCP tenant test are not built, so Liam cannot reach the read tools from Claude yet.
- **Theme Access fallback (T9).** Shopify lets an app write theme files only with an exemption. Without it, the approval returns "not written" and gives a `shopify theme push` command. A password-based CLI path is not built.
- **`read_all_orders`.** Requesting it means choosing a distribution model, which cannot be undone. Left until needed (see limitations).
- **Single-vs-multi-agent comparison (T7).** The eval switch exists (`AGENT_SINGLE_AGENT`). The run and the table do not.

## Not started: extras T12 to T19

Each is a feature from [docs/feature-map.md](docs/feature-map.md) the brief does not ask for. They run in this order after T10, and nothing outside a ticket gets built without Asim's go-ahead.

| Ticket | Idea |
|---|---|
| T12 | Gross margin, repeat rate and zero-sales days, cohort grids, payback, "need $X a day" in Pace |
| T13 | Supplier invoices to approved cost updates, questions over uploaded documents, call notes to plan changes |
| T14 | Data-health checks after each sync, instant growth audit when a store connects |
| T15 | Langfuse traces, a fallback model, evals in CI |
| T16 | Forecast, what-if scenarios, inventory runway, Black Friday war room |
| T17 | Promo post-mortems, merchandising analyses, retention segments |
| T18 | Saved playbooks, a Slack bot |
| T19 | About 3,000 orders with the two subtle storylines (S1, S2) and the weak BFCM cohort, in fresh stores |

If time runs short, cut from the bottom: T19 back to T12, then T10, T8 part D, T7, T9, T8 part C and T6. Nothing in T0 to T5 is cut.

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

- **Interim model.** Claude on Bedrock is blocked by an account restriction (AWS support case opened 2026-10-31), so the app runs on Devstral 2. Setting `BEDROCK_CLAUDE_ENABLED=true` switches the Claude entries on once access is granted. Nothing Claude-specific has been run: not the effort setting, not Opus synthesis, and the registry's prices are estimates. Devstral can pick the wrong metric. The number checker proves a number exists in a tool result, not that it is the right metric.
- **Demo clock.** When the newest order is over 36 hours old, "today" becomes the day after it. On Solenne "last month" is October and "this month" has no data. Tidepool's data ends 2026-10-26, so there "last month" stays September. The chat says so in a banner. Evals pin the clock.
- **Month-end edge.** On the last day of a month the chat's "this month" covers the whole month, so a gauge shows no estimate. `/pace` counts complete days only.
- **One currency per brand.** Money is stored in each shop's own currency and nothing converts. The portfolio ranks brands by gap in cents, which is only meaningful when they share a currency. Both demo stores are USD. Multiple currencies are a non-goal.
- **60-day order window.** Without `read_all_orders`, seeded orders stop being readable about 2026-12-30, and a store connected after that would sync no history. Rows already synced stay, because sync is upsert only.
- **Upsert only.** A line removed from an edited order, or a refund Shopify later deletes, stays in the synced copy.
- **Webhook gaps.** The shop-domain header is not covered by Shopify's HMAC. Two deliveries at the same instant can both run, which is safe because the write is an upsert.
- **Sync size.** Paged queries, not a bulk export. A sync must finish inside a 300-second function. A full Solenne sync (about 1,000 orders) works; a store of 100,000 orders would not.
- **No location names.** The app does not hold `read_locations`, so stock is by location id only.
- **Plan is monthly.** It holds five metrics by month. Refund-rate and quarter-total targets from a SOW come back as "not applied". The month-end estimate has no range or backtest.
- **Metrics not built.** `gross_margin`, `repeat_rate`, `zero_sales_days` and a `collection` dimension wait for T12. Definitions have not been compared with Shopify Analytics.
- **`DATA_STALE`** is defined and has banner text, but nothing raises it.
- **Tracing.** Runs are logged in `agent_runs` and `agent_steps`. There is no Langfuse and no fallback model, only one retry on the same model.
- **Spend cap.** One value for every brand.
- **Theme Check** has not been run on the deployed route.
- **Shared Bedrock key.** The key also serves another project and its policy allows more than invoking models. Production would use short-lived credentials.
- **Wrong time of day.** Solenne's last four orders (O_01021 to O_01024) carry the load time, not the planned one. Daily totals are unaffected.
- **Migrations** run by hand (`npm run db:migrate`), not on deploy.
