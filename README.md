# Oasis Pace

A Shopify app with an AI agent that answers questions about a store's data, built as a module for Oasis, Growth Capital's platform. Ask it about sales, orders, stock or customers and every number in the answer is checked against a query result before you see it. On top of that sits Growth Capital's planning loop: load a client's plan, track pace against it, explain misses, and propose changes that a person approves.

- **Live app:** https://oasis-pace.vercel.app (sign in with the demo login sent with the submission)
- **Loom walkthrough:** added with the submission
- **Built with:** Next.js 16 (App Router, TypeScript) on Vercel, Clerk (organisations and roles), Neon Postgres with Drizzle, the Shopify Admin GraphQL API (version 2026-10), the Vercel AI SDK on Amazon Bedrock.
- **How it was built:** Claude Code drafted plans and code from my decisions; I reviewed and own every decision.

## The thesis

An agent that talks about money must not make numbers up. So the model never does arithmetic and never sees the database. It calls a small set of typed tools (one per question family), each bound to the signed-in brand and each returning figures with their definitions and a query id. A checker then reads the finished answer and rejects any number that is not in that turn's tool results; the model gets one chance to fix it, and what it cannot source is flagged on screen. Everything else follows from that: the data lives in Postgres so the numbers are reproducible and testable, the demo stores are seeded with known stories so the answers can be graded, and every write the agent proposes goes through an approval ledger.

## Brief → where it's met

| Brief item | Status | Where |
|---|---|---|
| Test Shopify app | Built | `shopify.app.toml`, OAuth install in `app/api/shopify/`, signed webhooks (`orders/create`, `app/uninstalled`, the three compliance topics) |
| Test dev store | Built | Two Plus dev stores (Solenne, Tidepool) seeded with 14 months of orders and known storylines (`scripts/seed/`, `fixtures/`) |
| AI agent that queries the data on demand | Built | `/chat`, `lib/agent/` (loop, tools, number checker), a new order appears in answers within seconds of the webhook |
| Stretch: generative UI and dashboarding | Built | `render_view` (kpi, line, bar, table, gauge, waterfall), pinned views, `/pace` against plan |
| Stretch: document parsing | Built | `/plan`: upload a SOW PDF or plan CSV, review the targets read from it with their page, confirm as the active plan |
| Stretch: Shopify Liquid page generation | Built, with one caveat | `draft_landing_page`: copy from the model, Liquid built and checked on the server, approval card. Shopify requires an exemption for app theme writes, so the approved files are pushed with `npm run landing:push` (Shopify CLI) until the exemption is granted |
| Stretch: additional data sources | Built | Ad spend (MER, CAC), marketing calendar, call notes, plan targets |
| Beyond the list | Built | Why a month missed plan (`explain_gap`), approved writes to Shopify (Metric Target, annotation, discount off), weekly brief, portfolio view, team memory |
| Deferred | Not built | Slack posting of the brief, MCP access (see [ROADMAP.md](ROADMAP.md)) |

## What is in it

- **Chat** (`/chat`): suggested questions, saved threads, source popovers on every number, "what the metrics mean", a model picker. Answers lead with the figure, say which period and which metric definition were used, and say when the data was last synced.
- **Pace** (`/pace`): month to date against the plan. A target is spread over days using last year's pattern for the same month, so Black Friday does not make November look behind for three weeks. Where the month will land is shown as an estimate.
- **Why** (`explain_gap`): splits a finished month's gap into new and returning orders, their average order values and refunds (a midpoint split, so the parts add up exactly), looks for evidence in the store data, the marketing calendar and the call notes, and writes the explanation. A client viewer's version uses store data only.
- **Plan in** (`/plan`) and **Actions** (`/actions`): documents become plan targets; the agent can propose a Shopify target, an annotation, turning a discount code off or a landing page. Each proposal is a card with the exact change. A Growth Capital admin or partner approves, the server re-validates and runs it once, and the ledger records who and when. Approvals from the reviewer logins are a dry run that never touches the store.
- **Portfolio** (`/portfolio`) and **Briefs** (`/briefs`): brands ranked by dollars behind plan with the biggest driver of each; a weekly brief drafted through the same agent loop, blocked from approval if the checker finds a number it cannot source.
- **Roles:** `gc_admin` and `gc_partner` (Growth Capital staff, several brands) and `client_viewer` (one brand, read only: the chat with store data and the approved weekly briefs; no call notes, no write tools, and the Plan, Actions and Portfolio pages say they are for Growth Capital roles only).

## How it works

```
Browser ── Clerk session ──▶ Next.js route (tenant from the session, never from the request)
                               │
                               ▼
                       runAgent (lib/agent/run.ts)
        fixed system prompt · per-turn context · step cap · spend cap · audit log
                               │ tools bound to the tenant
          ┌────────────────────┼─────────────────────────┐
          ▼                    ▼                         ▼
   read tools (6)       view / memory tools       Why · Act · Landing tools
   query_metric …       render_view · remember    explain_gap · propose_action …
          │                                              │
          ▼                                              ▼
   Postgres (synced from Shopify)               Action ledger ──▶ Shopify (after approval)
          ▲
   Shopify Admin GraphQL (paged sync, daily cron, orders/create webhook)
```

- **Data:** Shopify is synced into Postgres (every table has `tenant_id` first), so answers do not depend on Shopify's query-cost limits and the metric layer can be tested against `truth.json`. Customers are pseudonymous ids; no name, email, phone or address column exists, and a test enforces it.
- **Metrics** (`lib/metrics/`): money is integer cents, rates are fractions, every metric has one definition that the agent quotes. Wholesale orders are tagged and can be left out; ad spend is never filtered by order filters.
- **Number checker** (`lib/agent/checker.ts`): builds a ledger from the turn's tool results (cents become dollars, fractions become percentages), reads every number in the answer, and ignores dates, ids, list numbers and product names. Unmatched numbers trigger one repair turn.
- **Untrusted text:** order notes, product descriptions, calendar entries, call notes and uploaded documents are data under an `untrusted` key. The prompt says so, the checker never takes a figure from them, and the evals include two injection cases.
- **Tenancy:** the tenant comes from the Clerk session (webhooks: the HMAC-verified shop; cron: `CRON_SECRET`). No tool schema has a tenant, shop or user field.
- **Writes:** the model never writes GraphQL or Liquid. Proposals are typed fields; the server builds the mutation (user text only in variables) and the page (fixed templates, prices read from Liquid objects, then our lint and Shopify's Theme Check). The ledger stores the payload and its hash, and an approval re-checks both and moves proposed to running in one conditional update, so a double click runs once. A write is never retried after a 5xx, because it may already have committed.

## Key decisions, and what was rejected

| Decision | Rejected | Why |
|---|---|---|
| Sync Shopify into Postgres and query that | Live GraphQL on every question; text-to-SQL | Query-cost limits and slow answers; text-to-SQL cannot guarantee a metric's definition or the tenant filter |
| Typed tools per question family | One generic query tool | Strict schemas with no tenant field are the authorization boundary |
| A number checker on the answer | Trusting the model; asking it to show its work | Checks the thing that matters (the figures), cheaply, on every answer |
| Seeded storylines (a bad batch, a leaked code, a budget cut) | Shopify's generated data | The agent has real things to find, and they are the ground truth for the evals |
| Standalone app with Clerk | Embedded Shopify admin app | Mirrors how Oasis is built; reviewers use a URL without Shopify admin access |
| Approval ledger for every write, dry run for reviewers | Letting the agent write directly | The demo is the same for every reviewer, and nothing reaches a store without a person |
| Model writes copy only for landing pages | Model writes Liquid | A typed price or a script tag in generated Liquid is a real risk; the server makes it impossible |

The reasoning is recorded as short ADRs in [docs/decisions/](docs/decisions/).

## Evals

`npm run eval` asks the real model each case's question against the fixture data (an in-memory database, today's date pinned) and grades the answer with deterministic checks: the expected figures come from the dataset and the fixture files, never from the code under test. Results are written to [docs/evals/latest.md](docs/evals/latest.md).

The full run on the default model, Claude Sonnet 4.6 (commit `d9e0b3c`): **22 of 24 cases pass**, at an estimated $1.99.

| Category | Passed | Cost |
|---|---|---|
| plan | 1 of 1 | $0.14 |
| memory | 1 of 1 | $0.10 |
| ads | 0 of 1 | $0.07 |
| why | 5 of 5 | $0.58 |
| lookup | 5 of 5 | $0.25 |
| comparison | 2 of 3 | $0.21 |
| storyline | 3 of 3 | $0.30 |
| injection | 2 of 2 | $0.10 |
| privacy | 1 of 1 | $0.02 |
| isolation | 1 of 1 | $0.11 |
| landing | 1 of 1 | $0.10 |

The 24 cases are 15 core cases (5 lookups, 3 comparisons, 3 storylines, 2 prompt-injection cases, a refused request for a customer's email, a Tidepool user asking about Solenne), 5 "why did we miss plan" cases (one per planted storyline and one month where nothing was planted), the 3 Pace cases and a landing-page case. The two that failed in this run:

- `mer-last-month`: the answer was right (MER 2.00) but it explained it as "for every $1 of ad spend, $2.00 of net sales", and the checker correctly refused those two dollar figures because no tool returned them.
- `compare-may-aov-wholesale`: both figures were right ($143.12 with the wholesale order, $81.47 without); the grader's window between a label and its figure was too narrow for a table. The window was widened and the case re-run: it passes.

The same suite on Devstral 2 passed 10 of 24 before the prompt fixes made after that run, so the model matters: Devstral's failures were mostly mislabelled figures (a store-wide refund total presented as one product's) and weak tool choices, not wrong numbers that slipped past the checker. The per-case results, answers and costs are in [docs/evals/latest.md](docs/evals/latest.md); the run does not depend on the day it is made or on the live store.

## Setup

Node 22 or newer. Copy `.env.example` to `.env.local` and fill it in, then:

```
npm ci
npm run db:migrate
npm run fixtures:load      # plan, ad spend, calendar and call notes
npm run dev
```

`npm run typecheck`, `npm run lint`, `npm test` (about 100 seconds, the tests use an in-memory Postgres) and `npm run eval` (calls the model). Everything else, including connecting a store, syncing, adding a brand, the reviewer logins and deploying, is in [docs/runbook.md](docs/runbook.md).

## Limitations

- **Models.** The agent defaults to Claude Sonnet 4.6 on Bedrock (EU inference profile). Devstral 2, Kimi K3 (slow, about a minute for a simple question) and MiniMax M2.5 are selectable in the chat. The Claude 5.5 models were not approved for the account when this was built; `BEDROCK_CLAUDE_ENABLED=true` switches the defaults to them when they are. Spend is capped per brand per day (`TENANT_DAILY_BUDGET_USD`, default $5), and a "why" answer costs roughly ten cents on Sonnet.
- **Demo clock.** The seeded data ends on 2026-10-31. If the newest order is more than 36 hours old the app treats the next day as today, so "last month" and "this month" stay meaningful. `npm run seed:topup` adds the days since, one complete day at a time.
- **Theme writes.** Shopify lets an app write theme files only after an exemption request. Without it, an approved landing page is finished with `npm run landing:push`.
- **Deferred.** Slack posting of the weekly brief and MCP access. Delivery of an approved brief is a log line until Slack is added.
- **Single currency.** The portfolio ranks brands by gap in cents and assumes the same currency.
- **Not a production system.** What a live Oasis module would add (token vaulting, per-tenant keys, the full permission model, ops and alerting) is designed in [docs/production/](docs/production/) and not built here.

More: [ROADMAP.md](ROADMAP.md), [docs/priorities.md](docs/priorities.md), [docs/build-plan.md](docs/build-plan.md).
