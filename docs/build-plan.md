# Oasis Pace: Build Plan

> **For agentic workers:** These are the steps for each ticket: the core in one day (T0–T5), every stretch feature (T6–T10), the extras from [feature-map.md](feature-map.md) (T12–T19), and the final ship (T11). The order is set in [priorities.md](priorities.md). It cuts the take-home plan, [implementation-plan.md](implementation-plan.md), where speed matters more than hardening. Where a step says "as in T#" or "as in T5-A", follow that part of the implementation plan, including its interfaces and tests, minus the cuts listed here. `CLAUDE.md` still applies: never stage, commit or push, ask before deploys and seed loads, and stop at each checkpoint. Each ticket is also a GitHub issue.

**Goal:** a deployed app with every feature in the brief working at demo quality, numbers that can be checked, and the thinking written down. Production hardening stays in [production/](production/).

**Spec:** [product-plan.md](product-plan.md), with the changes below.

## Tickets

| Ticket | Who | Time | What | Covers | Feature map |
|---|---|---|---|---|---|
| T0 | Asim | about 1 h | Accounts, apps, stores and keys | Core: app and dev store created | 1, 2, 4, 6 |
| T1 | Claude | about 2 h, then a background load | Generator, `truth.json`, every fixture, loader and a 20-order pilot, then the full load (about 3.5 h) | Core: dev store with test data. Seed data for every stretch feature | 3 (part), 4, 5 (part) |
| T2 | Claude | about 2.5 h | Next.js, Clerk, Neon, Shopify OAuth, webhooks, Vercel deploy | Core: installable app, secure auth, connection to live data | 1, 6, 20 (part) |
| T3 | Claude | about 2.5 h | Paged sync, 11 metrics, 6 tools, tests against `truth.json`, the `orders/create` webhook | Core: live data, read-only tools. Polish: filters, limits, validation, definitions, tests | 8, 14, 17, 42, 33 (part), 40 (part) |
| T4 | Claude | about 2.5 h | Bedrock check, agent, chat UI, number checker | Core: AI agent, chat UI with loading and error states. Polish: suggested questions, tables, logging | 7, 9, 12, 13, 15 (part), 18, 19, 20 (part) |
| T5 | Both | about 1.5 h | 15 evals, README v1, deploy, backup Loom | Core: README, Loom. A complete submission if time runs out | 10, 11, 16 |
| T6 | Claude | about 5 h | Stretch A, Pace: generated views, pinned views, saved threads, remembered facts, ad spend | Stretch: generative UI, history and memory, additional data sources | 21 (part), 22, 25 (part), 28 (part) |
| T7 | Claude | about 4–5 h | Stretch B, Why: parallel investigators over the data, calendar and call notes | Stretch: multi-agent, additional data sources | 26, 41 (part) |
| T8 | Claude | about 5 h | Stretch C and D, plan in and act: SOW PDF to confirmed targets, then approved writes to Shopify | Stretch: document parsing, write operations | 23 (part), 27 (part) |
| T9 | Claude | about 3–4 h | Stretch E, Liquid landing pages: pages for planned campaigns, validated and written to an unpublished theme | Stretch: Liquid generation, write operations | 24 |
| T10 | Claude | about 4–5 h | Stretch F and G, operate and MCP: portfolio, Monday brief to Slack, MCP server for Liam | Oasis extras: multi-client view, scheduled AI work, MCP | 29, 37 (part), 39 (part) |
| T12 | Claude | about 3–4 h | Extra: the three metrics cut for speed, cohort grids, contribution margin and payback, and "need $X a day" in Pace | Extends generative UI and additional data sources | 21, 25, 28 |
| T13 | Claude | about 5–8 h | Extra: supplier invoices to approved cost updates, Q&A over documents, and call notes to plan changes and action items | Extends document parsing and write operations | 23, 27, 41 |
| T14 | Claude | about 6–9 h | Extra: data-health checks after each sync, and an instant growth audit when a store connects | New: store checks | 30 ⭐, 40 |
| T15 | Claude | about 3–4 h | Extra: Langfuse traces, a fallback model, evals in CI | Ops | 15, 20, 44 |
| T16 | Claude | about 1.5–2 days | Extra: a forecast with what-if scenarios, inventory runway and reorder points, a Black Friday war room | New: forecasting | 31, 32, 33 |
| T17 | Claude | about 2 days | Extra: promo post-mortems, merchandising analyses, retention segments | New: growth analyses | 34, 35, 36 |
| T18 | Claude | about 3–4 h | Extra: saved playbooks run from the app | New: playbooks | 38 |
| T18b | Both | about 3–4 h | Extra: a Slack bot that answers questions and runs playbooks (split from T18 on 2026-11-02) | New: use it anywhere | 39 (Slack part) |
| T19 | Both | about 2 h, plus about 7 h of loading | Extra: about 3,000 orders with S1, S2 and the weak BFCM cohort, in fresh stores | Fuller demo data | 3, 5 |
| T11 | Both | about 2–3 h | Full evals, final README, final Loom | Ship | 10, 11, 16, 45 |

**Order:** set in [priorities.md](priorities.md).
- **Day 1:** T0–T5. T1's load runs in the background while T2 and T3 are built.
- **Stretch:** T6, T8 part C, T9; then T7, T8 part D, T10.
- **Extras:** T12 to T19, in order.
- **Last:** T11, whatever has been built.
- **Cutting:** any ticket after T5 can be cut without breaking what's before it. The cut order is in [priorities.md](priorities.md).

Core and stretch take about 4 working days, and the extras about 7–9 more. All of these are rough estimates.

## Changes from the product plan

- **Model provider.** Claude runs on Amazon Bedrock, through the AI SDK's Bedrock provider (`@ai-sdk/amazon-bedrock`). Chat uses Claude Sonnet 5.5, "why" synthesis uses Claude Opus 5.5, and titles use Claude Haiku 5.5. Model IDs are the Bedrock IDs noted on T0, kept in `lib/agent/models.ts`.
- **Data scale.**
  - Solenne has about 1,000 orders and Tidepool about 100. Storylines S3–S10, TP1 and TP2 are planted; S1 and S2 are skipped, because they're too subtle at this volume.
  - S3's wholesale order is $6,000.
  - S6's leak runs 2026-08-04 → 08-31, so the four weeks before S9 aren't affected by it.
  - S9 is checked against plan (October about 9% behind) and against the four weeks before 10-05 (new-customer orders about 30% lower).
- **Speed over hardening.**
  - Sync uses paged GraphQL queries instead of bulk operations.
  - There are 11 metrics (no `gross_margin`, `repeat_rate` or `zero_sales_days` until T12) and no `collection` dimension.
  - `search_products` reads Postgres.
  - A failed model call is retried once on the same model.
  - Runs are logged in `agent_runs` and `agent_steps`, not Langfuse.
  - Everything in [production/](production/) stays out.

---

## Day 1: core

### T0: Accounts and setup (Asim, about 1 hour)

As in the implementation plan's Day 0, with these specifics:
- [ ] **Shopify identity verification first.** Every Shopify step needs it, so if it stalls, the day stalls.
- [ ] Dev stores: Solenne (America/New_York, USD) and Tidepool (America/Los_Angeles, USD), on the Plus plan for the highest API limits (1,000 points a second against Basic's 100), with test data generation off.
- [ ] Product app and seeder app, both with custom distribution and installed on both stores. Protected customer data at Level 1 with no personal fields. Request `read_all_orders`; it isn't needed yet, because imported orders are within the 60-day window.
- [ ] A Vercel project (Hobby), linked to the GitHub repo.
- [ ] A Clerk development instance:
  - Organizations on, with roles `gc_admin`, `gc_partner` and `client_viewer`
  - sign-up set to invite-only, and users can't create organizations
  - orgs Solenne and Tidepool
  - users: Asim as `gc_admin` in both; `reviewer-gc+clerk_test@example.com` as `gc_partner` in both; `reviewer-client+clerk_test@example.com` as `client_viewer` in Solenne
- [ ] A Neon project (free plan).
- [ ] AWS Bedrock:
  - In one region, open Claude Sonnet 5.5, Opus 5.5 and Haiku 5.5 in the Bedrock console, and complete Anthropic's first-time-use form if asked.
  - Note each model's exact ID, or the region's inference-profile ID if the console gives one.
  - Create an IAM user whose policy allows only `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, with an access key.
  - Set an AWS Budgets alert, e.g. at $50.
- [ ] `.env.local`, with the variables listed in the implementation plan's T1. It's never committed.

### T1: Demo data and fixtures (about 2 hours, then the load runs in the background)

**Deliverable:** both stores seeded and checked against the dataset, plus `truth.json` and every fixture the stretch tickets need.

- [ ] As in implementation plan T2, at this plan's scale:
  - Solenne: about 1,000 orders from 2025-09-01 to today. Tidepool: about 100 orders from 2025-11-01.
  - Storylines S3–S10, TP1 and TP2, with the changes above.
  - All fixtures, each starting with the FICTIONAL SAMPLE line: `plan.csv`, `calendar.csv`, 4 call notes, `sow.md` rendered to `sow.pdf`, and `ad-spend.csv`.
  - The loader writes its journal to `.seed-journal/`, which is git-ignored.
- [ ] Tests:
  - The same seed and `--as-of` give the same dataset.
  - Storyline checks hold for S4, S6, S8, S9 and TP1.
  - `net_sales` equals the sum of its parts.
  - Loader, with mocked Shopify: a rerun skips done orders; an in-flight order is looked up before it's created again; a `userError` isn't journaled as done.
- [ ] **Pilot.** After asking Asim, load Solenne's first 20 orders and their refunds, read them back and compare them with the dataset.
- [ ] **Full load.** After asking Asim, load both stores in parallel. Solenne takes about 3.5 hours; carry on with T2 meanwhile.
- [ ] Spike (a): can orders backdated more than 60 days be read with `read_orders`? Record the answer in `docs/decisions/0001-day1-spikes.md`.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T2: Platform (about 2.5 hours)

**Deliverable:** the deployed app, with sign-in, both stores connected, and verified webhooks.

- [ ] As in implementation plan T1, all of it. The `.gitignore` already exists: when scaffolding in a temporary folder, merge the generated rules into it rather than replacing it.
- [ ] Asim runs the Shopify CLI login and `shopify app deploy`, because the login opens a browser.
- [ ] **Verify:** as in T1 (connect both stores as `gc_admin`, uninstall and reconnect, both reviewer logins from a fresh device).
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T3: Sync, metrics and tools (about 2.5 hours)

**Deliverable:** synced data matching `truth.json`, and the six tools ready for the agent.

- [ ] As in implementation plan T3, with these changes:
  - `syncStore` pages through products, variants, orders (with line items and refunds) and inventory using ordinary GraphQL queries, not a bulk operation.
  - The 11 metrics and the dimensions without `collection`. Daily buckets inside the data window are filled with zeros, so S5's and S7's empty days show up.
  - `search_products` reads Postgres.
  - The nightly refresh reruns the paged sync.
- [ ] Tests, as in T3: metric-vs-truth (exact) for both stores, Review Focus 1–5, tenant isolation, tool inputs, and the personal-data schema test.
- [ ] Once the load finishes: `npm run reconcile:truth` for both stores.
- [ ] The `orders/create` webhook (required). It's the Loom's proof that the agent works on live data.
- [ ] **Verify:** `npm test` passes; synced counts match the Shopify admin; `reconcile:truth` shows no unexplained differences.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T4: Agent and chat (about 2.5 hours)

**Deliverable:** the chat on the Vercel URL answers the suggested questions with checked numbers.

- [ ] **Spike first, 15 minutes.** Make one `streamText` call with a tool through `@ai-sdk/amazon-bedrock`, using the chat model ID from T0. Confirm that text streams, the tool runs and an effort setting is accepted. If effort can't be passed, keep the default and say so in the README.
- [ ] As in implementation plan T4, except: after a timeout or 5xx, retry once on the same model; and no Langfuse.
- [ ] Keep the number checker, the provenance popover, the error banners, the 8 suggested questions, "50 of N" tables, the demo-data banner and the markdown allow-list.
- [ ] Tests, as in T4: the checker cases, the agent loop with the mock model, the budget, and the error-code components.
- [ ] **Verify:** the suggested questions answer correctly on the Vercel URL.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T5: Core ship (about 1.5 hours)

**Deliverable:** a complete submission, in case the stretch runs out of time.

- [ ] **15 eval cases**, graded as in T4:
  - 5 lookups
  - 3 comparisons, including S3 with and without wholesale
  - 3 storyline checks: S4, S6 and S9
  - 2 injection cases: the S10 order note and the S10 product description
  - 1 request for a customer's email, which must be refused
  - 1 Tidepool user asking about Solenne
- [ ] Run `npm run eval` once and put the results table in the README.
- [ ] README v1, as in implementation plan T4 (Docs).
- [ ] Deploy, after asking Asim. Check both reviewer logins from a fresh device.
- [ ] Backup Loom of the core, following product plan §13 without the stretch step.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

## Stretch

### T6: Pace: generative UI, memory and ad data (stretch A, about 5 hours)

**Deliverable:** a pacing screen and chat answers rendered as approved components, saved threads and confirmed client facts, and ad-spend metrics.

- [x] As in implementation plan T5-A: plans loaded from `plan.csv`, `render_view` with the six components, `/pace` with month-to-date against plan and where the month will land, pinned views, saved threads, `memories` with confirmation, and `ad_spend` with `mer` and `new_customer_cac`.
- [x] Cut: the month-end estimate has no range or backtest.
- [x] Tests, as in T5-A.
- [x] Eval cases: a pacing question that renders a gauge; a remembered "exclude wholesale" rule that changes the answer; a MER question. `npm run eval` runs them (3 of 3 pass on Devstral 2; results in `docs/evals/latest.md`). T5 grows this runner into the full set.
- [x] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

**Result (2026-10-31).** Live checks on the Vercel URL as the `gc_partner` reviewer, Solenne:
- `/pace` shows October to date and September finished; October to date matches the dataset exactly (net sales $5,583.60, 79 orders, 33 new-customer orders, average order value $75.06, returning rate 58.2%).
- A pacing question drew a gauge; a daily net-sales question drew a line, which pinned to `/pace` and unpinned; a bar by channel drew 48, 13, 11, 6 and 2 orders (80).
- Saved conversation: reopened after a reload with both views restored, and a follow-up ("that same period") used the saved history.
- Note: proposed, shown with Confirm and Dismiss, confirmed, then used (the AOV query left wholesale out and said so); removed afterwards.
- Known edge: on the last day of a month the chat's "this month" covers the whole month, so a gauge shows plan so far equal to the target and no estimate. `/pace` counts complete days only.

### T7: Why: multi-agent explanations (stretch B, about 4–5 hours)

**Status (2026-10-31): built and checked live on Devstral.** `driverTree` (midpoint split, parts add to the gap exactly), `explain_gap` with three investigators and a synthesis step, `get_calendar` and `get_notes` for GC roles only, the calendar and call-note loader, and five "why" eval cases in `evals/why-cases.ts` (deterministic graders, no judge model). Evidence is gathered in code (a pack of product movers, refunds, stock-outs, calendar and call notes) and the investigators interpret it. Why evals: see docs/evals/latest.md. Not done: the single-vs-multi-agent comparison table.

**Deliverable:** "Why did we miss plan in October?" answered by parallel investigators, with causes from the data, the calendar and the call notes.

- [ ] As in implementation plan T5-B: `driverTree` with the midpoint split, three parallel investigators on the chat model, synthesis on Opus 5.5, and `get_calendar` and `get_notes` for GC roles only.
- [ ] The single-agent vs multi-agent comparison table in the README.
- [ ] Unit tests, as in T5-B.
- [ ] Five "why" eval cases: S4, S5, S7, S9, and one month where nothing was planted. Graded by cause recall with a Haiku judge.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T8: Plan in and act: document parsing and approved writes (stretch C and D, about 5 hours)

**Status (2026-10-31): built and checked live.** Plan in: upload (PDF/CSV, 4 MB, GC roles), two-pass reader with quote verification, review screen at `/plan`, confirm swaps the active plan; `a try script, `scripts/plan-in-try.ts`, runs the real reader once. Act: `propose_action` plus executors for a Metric Target, an annotation and `VIPGLOW25`, on the T9 ledger. Scopes added to `shopify.app.toml`; `shopify app deploy` and the approval click in each store are next. Refund-rate and quarter-total targets come back as "not applied" because the plan holds monthly metrics only.

**Deliverable:** the SOW PDF becomes a confirmed plan, and the agent proposes writes to Shopify that run only after a person approves.

Done in two passes ([priorities.md](priorities.md)): Plan in at priority 8, and Act at priority 11, after T9.

- [ ] **Plan in**, as in implementation plan T5-C: upload (PDF and CSV only, up to 4 MB, GC roles only), the two-pass reading (citations first, then structured output), and a review screen that confirms the targets as changes to the plan.
- [ ] **Act**, as in implementation plan T5-D: `propose_action`, the approval card, a single-run approval, and the three writes: Metric Targets, an annotation and deactivating VIPGLOW25. Approvals from the reviewer logins are a dry run. Every action goes in the ledger. T9 builds the approval card and ledger first, and Act reuses them.
- [ ] Add the stretch D scopes to `shopify.app.toml`. After asking Asim, run `shopify app deploy` and approve the new permissions in each store's admin.
- [ ] Tests, as in T5-C and T5-D.
- [ ] Eval case: the fixture SOW gives the expected targets and pages.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T9: Liquid landing pages (stretch E, about 3–4 hours)

**Status (2026-10-31): built and checked live.** The action ledger (`lib/actions/`), the approval card, `/actions`, reviewer dry runs, and `draft_landing_page` (the model writes words only; the server builds the Liquid, prices come from `| money`, Theme Check runs). The theme-write spike script is `scripts/spikes/theme-write.ts`; Shopify gates `themeFilesUpsert` behind an exemption (confirmed live): an approval records "not written" and `npm run landing:push` finishes the page through the Shopify CLI (run live: files in the unpublished copy, hidden page created).

**Deliverable:** from chat, a GC partner asks for a landing page for a planned campaign, gets a validated Liquid page to review, and on approval it's written to an unpublished copy of the store's theme.

- [ ] **Spike first, 30 minutes.** On a dev store, confirm the app can write a file to an unpublished theme (`themeFilesUpsert`) and create a hidden page that uses the new template. Record the exact scopes needed. If the API isn't allowed to write themes, the fallback is Shopify CLI with the Theme Access app: the approved files are pushed to the unpublished theme with `shopify theme push`.
- [ ] Asim duplicates Solenne's theme in the Shopify admin (an unpublished copy).
- [ ] A `draft_landing_page` tool takes a campaign from `calendar.csv` (for example, Black Friday) or a product (for example, the Fig restock). It returns:
  - a Liquid section and a page template that uses it
  - product handles from the tools' results
  - prices and stock that come from Liquid objects (`product.price | money`), so the page shows live store values and contains no number the model typed
- [ ] The draft is checked with Shopify's Theme Check, with one repair turn if it fails. The app shows the code, the check result and a link to the theme editor.
- [ ] Writing the files and creating the hidden page is a proposed action. T9 runs before T8's Act part, so it builds the approval card, the single-run approval and the action ledger, and T8 reuses them. Reviewer approvals are dry runs. A person publishes in the Shopify admin.
- [ ] Tests:
  - A template with a typed-in price is rejected.
  - Every product handle in the draft exists.
  - Invalid Liquid fails the check.
  - Nothing is written without approval.
- [ ] Eval case: a Black Friday page draft passes Theme Check and references real handles.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T10: Operate and MCP: portfolio, Monday brief, Liam (stretch F and G, about 4–5 hours)

**Status (2026-10-31): the in-app part is built and checked live; Slack and MCP are deferred by Asim.** `/portfolio` (GC roles), the weekly brief cron (Monday 06:00 UTC) through the shared agent loop, `/briefs` approval, delivery is a log line until Slack is added. Not built: the Slack webhook and posting, `/api/mcp`, Clerk OAuth, and the MCP tenant test.

**Deliverable:** a staff portfolio across both brands, a weekly brief that GC approves before it's posted to Slack, and the read tools available to Liam over MCP.

- [ ] Asim creates a Slack incoming webhook for a sandbox channel (`SLACK_WEBHOOK_URL`).
- [ ] `/portfolio`, for GC roles only: ranks the user's brands by dollars behind plan, with the top driver for each from `driverTree` (by gap to plan only, if T7 was cut).
- [ ] Monday brief:
  - A weekly cron route, checked against `CRON_SECRET`, drafts one brief per brand through the shared agent loop, so the number checker runs on it.
  - Drafts are stored, and a GC partner approves one before it's posted to Slack with link previews off.
  - A brief with an unmatched number can't be approved. Reviewer approvals post to the log instead of Slack.
- [ ] MCP:
  - `/api/mcp` exposes the read tools through Clerk OAuth. Each token is bound to one client org at consent, and no tool takes a tenant argument.
  - Every call is logged with `source: 'mcp'`.
- [ ] Tests:
  - A `client_viewer` gets 403 on `/portfolio`.
  - A brief is never posted without approval, and an unmatched number blocks approval.
  - An MCP token for Solenne can't read Tidepool.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

## Extras: the rest of the feature map

Each extra is a feature from [feature-map.md](feature-map.md) that the brief doesn't ask for. They run in order after T10, and any of them can be cut.

### T12: Deeper metrics: margin, cohorts and pace targets (about 3–4 hours)

**Deliverable:** the three metrics cut for speed are back, and Pace and the views use them.

- [ ] Restore `gross_margin`, `repeat_rate` (with the cohort input from implementation plan T3) and `zero_sales_days`, as defined in product plan §8. `truth.ts` computes them, and the metric-vs-truth tests cover them.
- [ ] A cohort grid view component: first-order month against months since, using `repeat_rate` (feature 21).
- [ ] Contribution margin (net sales less cost of goods less ad spend) and payback (the months until a cohort's gross margin covers its new-customer CAC) (feature 25).
- [ ] Pace shows "need $X a day to hit plan" for the rest of the month, returned by the tool so the checker can match it (feature 28).
- [ ] Eval cases: a cohort-grid question, a payback question, and "how much a day do we need?".
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T13: Documents in: supplier invoices and call notes (about 5–8 hours)

**Deliverable:** two more kinds of document become proposals a person approves (an invoice becomes unit-cost updates; a call note becomes plan changes and action items), and any uploaded document can be questioned.

- [ ] A fictional supplier invoice PDF for Solenne, with the FICTIONAL SAMPLE header and new unit costs for five variants.
- [ ] Invoices upload through T8's upload, with the same limits, and are read in the same two passes. The structured output is `{ sku, unitCost, currency, page }[]` (feature 23).
- [ ] Questions about an uploaded document are answered from the document with page citations.
- [ ] Unit-cost updates are a proposed action, through T9's approval card and ledger, and a dry run for reviewers. A 15-minute spike confirms the inventory-item cost mutation and its scope first (feature 27).
- [ ] After an approved cost change, `gross_margin` (T12) reflects the new costs from that day on.
- [ ] A new call note proposes plan changes, confirmed like T8's targets, and action items, stored with an owner and a due date and shown on `/pace` (feature 41).
- [ ] Tests:
  - Costs change only after approval.
  - A SKU that isn't in the store is rejected.
  - Document answers cite pages.
  - Action items are tenant-scoped.
- [ ] Eval cases: invoice extraction; a document question answered with its page; a call note that yields the expected action item.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T14: Store checks: data health and instant growth audit (about 6–9 hours)

**Deliverable:** a health check after every sync, and a growth audit with the top three opportunities when a store connects.

- [ ] Data-health checks after each sync, shown on `/connect` and through a `get_data_health` tool (feature 40):
  - variants without a unit cost
  - orders without a customer
  - days with no orders inside the data window
  - single orders that skew averages, such as S3's wholesale order
  - sync lag
- [ ] A growth audit (feature 30) runs on a newly connected store: data health, headline metrics, then three opportunities, each with the numbers behind it.
  - The checks are fixed code: discount dependence, repeat rate, stock risk and refund outliers.
  - The model only writes them up, through the shared agent loop, so the number checker runs on the write-up.
  - The result is a one-page report view.
- [ ] The demo runs the audit on Tidepool. Auditing a prospect's store needs a public app, which is in the production plan.
- [ ] Tests: each health check fires on a fixture that has its problem; every number in the audit matches a tool result.
- [ ] Eval case: the audit on Tidepool names the swaddle's stock risk (TP2).
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T15: Ops: traces, model fallback and evals in CI (about 3–4 hours)

**Deliverable:** the three operational pieces cut for speed.

- [ ] Langfuse tracing, as in implementation plan T4: tagged by tenant, route, model and tool, with no prompts or tool payloads, and flushed in `after()` (feature 15).
- [ ] After a timeout or 5xx on the chat model, one retry on Opus 5.5 (feature 20).
- [ ] Evals in CI (feature 44):
  - A workflow runs the eval set on demand, and on pull requests that change `lib/agent`, `lib/tools`, prompts or `models.ts`.
  - It uses AWS credentials from Actions secrets, with a cost cap per run.
  - It writes a scoreboard (accuracy, cost and latency) to `docs/evals/`.
  - Pull requests from forks get no secrets, so they skip the run.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T16: Forecasting: scenarios, inventory runway and Black Friday war room (about 1.5–2 days)

**Deliverable:** forecasts the agent can explain: a baseline forecast, what-if scenarios, days of stock and reorder points, and a Black Friday view that combines them.

- [ ] A baseline forecast of daily net sales and units by product for the next 60 days. It uses last year's shape for the same season, scaled by the recent run rate, and is shown with a range. It's backtested on the last three months, with the error reported in the README.
- [ ] Scenarios (feature 32): what-ifs for discount depth, the free-shipping threshold and price. The elasticities are assumptions the user sets, such as "a 10% price rise loses 12% of units", because this dataset has no price or threshold storylines to learn them from. Every answer states the assumption.
- [ ] Inventory runway (feature 33): days of stock left per variant at the forecast rate, and reorder points from a supplier lead time (a fixture) and safety stock.
- [ ] A Black Friday war room (feature 31): one view with forecast demand by product, stockout risk (runway against forecast) and a what-if P&L for the planned discount.
- [ ] Tests: the backtest error stays under a stated threshold on the fixtures; the runway and scenario maths are deterministic.
- [ ] Eval cases: "Will the swaddle last through Black Friday?" (TP2), and BFCM25 at 20% against 25%.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T17: Growth analyses: promo post-mortems, merchandising and retention segments (about 2 days)

**Status (2026-11-02): slice 1 (promo post-mortems) and slice 2 (merchandising and retention segments) built.** Slice 1: the `get_promo_postmortem` tool is in `lib/tools/promo-postmortem.ts`, with the baseline, pull-forward and cohort maths in `lib/metrics/postmortem.ts`. For a code or a date window it returns the extra sales against a baseline of the days before, the sales pulled forward from the days after, the net lift, the cost of the offer, and the repeat rate of the customers it brought against a comparison group. Its tests run on the fixtures for BFCM25 (S8) and VIPGLOW25 (S6). Two eval cases are in `evals/t17-cases.ts`, each run once live on 2026-11-02 (they are paid, so run them only with Asim's go-ahead). `postmortem-bfcm25` passed 12 of 12 ($0.21). `postmortem-vipglow25` passed 12 of 13 ($0.13): the model wrote the repeat-rate gap as "16.7 percentage points", which the number checker then read as an untraced count. The checker now reads "percentage points", "percent" and "pp" as a percentage, and the saved answer re-checks clean offline; the case has not been re-run live.

Slice 2 has three agent tools. `get_bundle_candidates` (`lib/tools/bundles.ts`, maths in `lib/metrics/merchandising.ts`) lists the products bought together, with the orders that held both, support, confidence and lift. `get_launch_curves` (`lib/tools/launch-curves.ts`, maths in `lib/metrics/launch.ts`) gives units by week since a product's first sale against the median launch; the products table has no publish date, so a launch is the first sale. `get_customer_segments` (`lib/tools/customer-segments.ts`, maths in `lib/metrics/segments.ts`) gives RFM scores, lifetime value, a churn-risk heuristic and the four segments: champions, at risk, due to reorder and one and done. The `/segments` page (Growth Capital roles only) shows them, the Klaviyo CSV downloads from `/api/segments/export`, and the `segment_create` action saves one of the four segments in Shopify after approval. The Shopify write is built and tested against a fake Shopify client only; it needs the `write_customers` scope and a deploy before it can run live. The three eval cases (`segments-at-risk`, `bundles-bought-together`, `launch-curve-gua-sha`) were each run once live on 2026-11-02 (paid): `launch-curve-gua-sha` passed 11 of 11 ($0.14); `segments-at-risk` passed 9 of 11 ($0.09) because the case demanded a list view when a summary answer is right, and `bundles-bought-together` passed 9 of 10 ($0.18) because the number checker read the row numbers of a "#" table column as figures. The case and the checker were fixed, and both saved answers re-check clean offline; neither was re-run live. The fixtures plant no product launch, so the launch case uses a slow seller whose first sale came late (the Gua Sha Stone) and checks that the answer calls the launch a first sale and does not invent a ramp.

**Deliverable:** three analyses GC operators run often, as tools the agent can call.

- [x] Promo post-mortems (feature 34): for a code or an event, the extra sales against sales pulled forward (baselines from the weeks before and after), and the quality of the customers it brought (repeat rate, from T12). Demo on BFCM25 (S8) and VIPGLOW25 (S6). Built in slice 1; the demo is the tool's tests on the fixtures, and the answers the agent gives are the unrun eval cases below.
- [x] Merchandising (feature 36): products often bought together, as bundle candidates; and launch curves (units by days since launch). Built in slice 2 as `get_bundle_candidates` and `get_launch_curves`. The launch curve is by week since the first sale. On the Solenne fixtures the lifts run from 0.7 to 1.9 and the launches are thin slow sellers, so there is no bundle or ramp story to find, and the eval cases ask for an honest answer instead.
- [x] Retention segments (feature 35): built in slice 2 as `get_customer_segments`, the `/segments` page, the Klaviyo CSV and the `segment_create` action.
  - RFM scores, LTV and churn risk per pseudonymous customer, and segments such as champions, at risk, one-and-done and due to reorder.
  - On approval, a segment is created in Shopify, through T9's approval card. A 15-minute spike confirms the segment mutation and its scope first. If it needs more than Level 1 customer data, segments stay in Oasis. The `segment_create` write is built and tested against a fake Shopify client only; it needs a scope and a deploy before it can run live.
    - **Spike result (2026-11-02, from the Shopify docs for API 2026-10; no live call):** the mutation is `segmentCreate(name, query)`, and it returns the segment or `userErrors`. It needs the `write_customers` scope, which the app does not have, so a call today returns `ACCESS_DENIED`. It probably needs no more than Level 1 customer data, because a query on order count and last-order date reads no personal fields, but the docs do not say so outright. The query language has `number_of_orders` and `last_order_date`, comparisons, `-90d` style dates and `AND` (at most 10 clauses). It cannot compare a customer with their own usual gap, so "due to reorder" is an approximation. `write_customers` is now in `shopify.app.toml`, in `WRITE_SCOPES` (`lib/shopify/connect.ts`) and in the permissions panel. To run it live: Asim runs `shopify app deploy --allow-updates` to release it, presses Update permissions for each store and accepts it, then approves a segment card as a real Growth Capital user. That first run is also the only check of the query syntax. Until then, approving fails safely and creates nothing.
  - Export for Klaviyo is a CSV, because there's no Klaviyo account, and the README says how a sync would work. The CSV is built at `/api/segments/export`.
- [x] Tests: the post-mortem baseline maths (done in slice 1); the RFM scoring, the bundle and launch maths, and that nothing is created in Shopify without approval (done in slice 2, the last one through the approval ledger and a spy standing in for Shopify).
- [ ] Eval cases: "Was VIPGLOW25 worth it?" (S6, in August; with a Black Friday case for BFCM25 (S8). Both run once live: BFCM25 12 of 12, VIPGLOW25 12 of 13 before a checker fix); "Which customers are at risk?". The slice 2 cases (`segments-at-risk`, `bundles-bought-together` and `launch-curve-gua-sha`, in `evals/t17-cases.ts`) were each run once live on 2026-11-02: launch 11 of 11, at-risk 9 of 11 and bundles 9 of 10 before a case fix and a number-checker fix (see the status paragraph); the last two have not been re-run live.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T18: Playbooks (about 3–4 hours)

**Status (2026-11-02): built and run once live.** The three playbooks are in `lib/playbooks/` (`bfcm-review`, `retention-check`, `monthly-review`). Each sends one fixed question, written on the server, through the shared agent loop, so the number checker runs on the write-up. `/playbooks` (GC roles only) runs one with a click through `POST /api/playbooks`, and every run is stored per brand in `playbook_runs` (migration 0008, additive). Each run is one paid call, and a brand can run each playbook once per 10 minutes. The eval cases are `playbook-monthly-review-october` (passes 8 of 8, $0.14) and `playbook-retention-check` (written after a live retention run was blocked for stating a raw fraction; its figures trace, checked once at $0.08) in `evals/t18-cases.ts`. They are paid, so run them only with Asim's go-ahead. A live run of each playbook costs about $0.12 to $0.14.

**Deliverable:** saved playbooks the agent runs from the app. The Slack side is T18b below.

- [x] Playbooks (feature 38): a BFCM review, a retention check and a monthly business review. Each is a saved sequence of tool calls plus a write-up template, run through the shared agent loop so the checker runs. The output is a report view, for GC roles only.
- [x] Tests: every number in a playbook matches a tool result.
- [x] Eval case: the monthly business review for October names the budget cut (S9). Passes 8 of 8 (2026-11-02).
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T18b: Slack bot (about 3–4 hours)

Split out of T18 on 2026-11-02 (Asim). Needs T18, because the bot runs the playbooks, and a Slack app that Asim creates. T10b (Slack posting of the Monday brief, deferred) can share that Slack app: it needs an incoming webhook, the bot needs a bot token and a signing secret.

**Deliverable:** a Slack bot that answers questions and runs playbooks in a channel.

- [ ] The bot answers questions in a channel and runs a playbook on request.
- [ ] Each channel maps to one brand; a `gc_admin` sets the mapping, and requests run as that brand's tenant.
- [ ] Slack's request signature is checked, and link previews are off.
- [ ] Asim creates the Slack app and gives the bot token and the signing secret.
- [ ] Tests:
  - A request with a bad signature is rejected.
  - A channel mapped to Solenne can't read Tidepool.
- [ ] No new eval case: the playbook case in T18 covers what the bot runs.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

### T19: Fuller dataset: 3,000 orders and the subtle storylines (about 2 hours, plus about 7 hours of loading)

**Deliverable:** the full dataset from the product plan, with the storylines skipped on day 1.

- [ ] Generate about 3,000 Solenne orders, adding S1 (the price increase), S2 (the shipping threshold) and S8's weak BFCM cohort (features 3 and 5).
- [ ] After asking Asim, load them into fresh dev stores, or reset the existing ones, because the generator's output changes for every order. Run the load overnight.
- [ ] Reconnect, re-sync, re-run `reconcile:truth`, update the eval expectations from the new `truth.json`, and re-run the evals.
- [ ] It replaces the demo data late in the build, so do it only with a day to spare before T11.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

## Last: final ship

### T11: Final ship (about 2–3 hours)

**Deliverable:** the final submission, with whatever has been built.

- [ ] Evals: the 15 core cases plus the cases of every stretch and extra ticket that was built, run once. The README results table is updated.
- [ ] README:
  - "Brief → where it's met" marks every item built.
  - "What production would add" links `docs/production/`.
  - Each stretch feature gets a screenshot or short clip.
- [ ] `docs/runbook.md` and `ROADMAP.md` updated.
- [ ] Final deploy, after asking Asim. Check both reviewer logins from a fresh device.
- [ ] Final Loom:
  - A 5-minute main video following product plan §13.
  - A second short video, if needed, for the features that don't fit (Liquid pages, the portfolio and brief, MCP, and the extras).
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.
