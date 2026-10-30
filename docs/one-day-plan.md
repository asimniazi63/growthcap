# Oasis Pace: One-Day Build

> **For agentic workers:** This is today's build order. It cuts the take-home plan, [implementation-plan.md](implementation-plan.md), down to one day. Where a step says "as in T#", follow that ticket of the implementation plan, including its interfaces and tests, minus the cuts listed here. `CLAUDE.md` still applies: never stage, commit or push, ask before deploys and seed loads, and stop at each checkpoint.

**Goal:** by the end of the day, a deployed app where a reviewer signs in from any device, asks about a seeded Shopify store and gets checked, sourced answers, plus the README and the Loom.

**Spec:** [product-plan.md](product-plan.md), with the changes below.

## Today and later

| Area | Today | Later (from the implementation plan) |
|---|---|---|
| Data | Solenne about 1,000 orders (about 3.5 hours to load); Tidepool about 100 | Solenne about 3,000 orders |
| Storylines | S3–S10 and TP2, planted with bigger effects | S1, S2 and TP1 |
| Fixtures | `dataset.json` and `truth.json` only | Plan, calendar, call notes, SOW, ad spend (stretch) |
| Sync | Paged GraphQL queries on connect, on Resync and nightly; the `orders/create` webhook if time allows | Bulk operations |
| Metrics | 11: all but `gross_margin`, `repeat_rate` and `zero_sales_days` | All 14 |
| Dimensions | All but `collection` | All 10 |
| Tools | All 6; `search_products` reads Postgres | `search_products` calls Shopify live |
| Model fallback | One retry on the same model | A retry on another model |
| Evals | 15 cases, run once before the Loom | About 27 cases |
| Observability | `agent_runs` and `agent_steps` | Langfuse |
| Stretch | None | A–D |

## Changes from the product plan for today

- **Model provider.** Claude runs on Amazon Bedrock, through the AI SDK's Bedrock provider (`@ai-sdk/amazon-bedrock`). Chat uses Claude Sonnet 5.5, and titles use Claude Haiku 5.5. Model IDs are the Bedrock IDs noted on T0, kept in `lib/agent/models.ts`.
- **Storyline sizes for about 1,000 orders.**
  - S3's wholesale order is $6,000.
  - S6's leak runs 2026-08-04 → 08-31, so the four weeks before S9 aren't affected by it.
  - S9 is checked as new-customer orders from 10-05 onward against the four weeks before 10-05: about 30% lower.
  - Every planted effect is still exact counts and at least 2.5× the natural variation of its window.
- **No plan targets today**, so questions about "behind plan" wait for stretch A.

## Timeline

| Time | Asim | Claude Code |
|---|---|---|
| 0:00–1:00 | T0: accounts, apps, stores, keys | T1: generator and `truth.ts` (no accounts needed) |
| 1:00–1:30 | Approve the pilot load, then the full load | T1: loader and pilot, then start the full load, which runs about 3.5 hours in the background |
| 1:30–4:00 | Shopify CLI login and deploy when asked | T2: platform |
| 4:00–6:30 | Check `/connect` | T3: sync, metrics and tools (the load finishes around 5:00) |
| 6:30–9:00 | Try the chat | T4: agent and chat |
| 9:00–11:00 | Record the Loom | T5: evals, README, final deploy |

**Cost today:** the Bedrock calls for development plus one eval run. At Claude API list prices that's roughly $10–40; check Bedrock's pricing page for the exact rates.

---

### T0: Accounts and setup (Asim, about 1 hour)

As in the implementation plan's Day 0, with these specifics:
- [ ] **Shopify identity verification first.** Every Shopify step needs it, so if it stalls, the day stalls.
- [ ] Dev stores: Solenne (America/New_York, USD) and Tidepool (America/Los_Angeles, USD), with test data generation off.
- [ ] Product app and seeder app, both with custom distribution and installed on both stores. Protected customer data at Level 1 with no personal fields. Request `read_all_orders`; today doesn't need it, because imported orders are within the 60-day window.
- [ ] A Vercel project (Hobby), linked to the GitHub repo.
- [ ] A Clerk development instance:
  - Organizations on, with roles `gc_admin`, `gc_partner` and `client_viewer`
  - sign-up set to invite-only, and users can't create organizations
  - orgs Solenne and Tidepool
  - users: you as `gc_admin` in both; `reviewer-gc+clerk_test@example.com` as `gc_partner` in both; `reviewer-client+clerk_test@example.com` as `client_viewer` in Solenne
- [ ] A Neon project (free plan).
- [ ] AWS Bedrock:
  - In one region, open Claude Sonnet 5.5 and Claude Haiku 5.5 in the Bedrock console, and complete Anthropic's first-time-use form if asked.
  - Note each model's exact ID, or the region's inference-profile ID if the console gives one.
  - Create an IAM user whose policy allows only `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`, with an access key.
  - Set an AWS Budgets alert, e.g. at $50.
- [ ] `.env.local`, with the variables listed in the implementation plan's T1. It's never committed.

---

### T1: Demo data (about 1.5 hours, then the load runs in the background)

**Deliverable:** both stores seeded and checked against the dataset, plus `dataset.json` and `truth.json` for each store.

- [ ] As in implementation plan T2, at today's scale:
  - Solenne: about 1,000 orders from 2025-09-01 to today. Tidepool: about 100 orders from 2025-11-01.
  - Storylines S3–S10 and TP2, with the changes above.
  - Fixtures: `dataset.json` and `truth.json` only.
  - The loader writes its journal to `.seed-journal/`, which is git-ignored.
- [ ] Tests:
  - The same seed and `--as-of` give the same dataset.
  - Storyline checks hold for S4, S6, S8 and S9; S9's new-customer drop is 25–35%.
  - `net_sales` equals the sum of its parts.
  - Loader, with mocked Shopify: a rerun skips done orders; an in-flight order is looked up before it's created again; a `userError` isn't journaled as done.
- [ ] **Pilot.** After asking Asim, load Solenne's first 20 orders and their refunds, read them back and compare them with the dataset.
- [ ] **Full load.** After asking Asim, load both stores in parallel. Solenne takes about 3.5 hours; carry on with T2 meanwhile.
- [ ] Spike (a) only: can orders backdated more than 60 days be read with `read_orders`? Record the answer in `docs/decisions/0001-day1-spikes.md`.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

### T2: Platform (about 2.5 hours)

**Deliverable:** the deployed app, with sign-in, both stores connected, and verified webhooks.

- [ ] As in implementation plan T1, all of it. The `.gitignore` already exists: when scaffolding in a temporary folder, merge the generated rules into it rather than replacing it.
- [ ] Asim runs the Shopify CLI login and `shopify app deploy`, because the login opens a browser.
- [ ] **Verify:** as in T1 (connect both stores as `gc_admin`, uninstall and reconnect, both reviewer logins from a fresh device).
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

### T3: Sync, metrics and tools (about 2.5 hours)

**Deliverable:** synced data matching `truth.json`, and the six tools ready for the agent.

- [ ] As in implementation plan T3, with these changes:
  - `syncStore` pages through products, variants, orders (with line items and refunds) and inventory using ordinary GraphQL queries, not a bulk operation. That's quick at this size.
  - The 11 metrics and the dimensions without `collection`. Daily buckets inside the data window are filled with zeros, so S5's and S7's empty days show up.
  - `search_products` reads Postgres.
  - The nightly refresh reruns the paged sync.
- [ ] Tests, as in T3: metric-vs-truth (exact) for both stores, Review Focus 1–5, tenant isolation, tool inputs, and the personal-data schema test.
- [ ] Once the load finishes: `npm run reconcile:truth` for both stores.
- [ ] If time allows: the `orders/create` webhook, for the Loom's first step.
- [ ] **Verify:** `npm test` passes; synced counts match the Shopify admin; `reconcile:truth` shows no unexplained differences.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

### T4: Agent and chat (about 2.5 hours)

**Deliverable:** the chat on the Vercel URL answers the suggested questions with checked numbers.

- [ ] **Spike first, 15 minutes.** Make one `streamText` call with a tool through `@ai-sdk/amazon-bedrock`, using the chat model ID from T0. Confirm that text streams, the tool runs and an effort setting is accepted. If effort can't be passed, keep the default today and say so in the README.
- [ ] As in implementation plan T4, with these changes:
  - After a timeout or 5xx, retry once on the same model.
  - No Langfuse; `agent_runs` and `agent_steps` are the log.
- [ ] Keep the number checker, the provenance popover, the error banners, the 8 suggested questions, "50 of N" tables, the demo-data banner and the markdown allow-list.
- [ ] Tests, as in T4: the checker cases, the agent loop with the mock model, the budget, and the error-code components.
- [ ] **Verify:** the suggested questions answer correctly on the Vercel URL.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

### T5: Ship (about 2 hours)

**Deliverable:** eval results, the README and the Loom.

- [ ] **15 eval cases**, graded as in T4:
  - 5 lookups
  - 3 comparisons, including S3 with and without wholesale
  - 3 storyline checks: S4, S6 and S9
  - 2 injection cases: the S10 order note and the S10 product description
  - 1 request for a customer's email, which must be refused
  - 1 Tidepool user asking about Solenne
- [ ] Run `npm run eval` once and put the results table in the README.
- [ ] README, as in implementation plan T4 (Docs): the 400-word summary, the "brief → where it's met" table, decisions, setup, the eval table, "What production would add" (linking `docs/production/`), and the line on how it was built.
- [ ] A short `docs/runbook.md`.
- [ ] Final deploy, after asking Asim. Check both reviewer logins from a fresh device.
- [ ] Loom, following product plan §13 without the stretch step. Give that time to the decisions and production segment. If the webhook wasn't built, show Resync in step 1 instead.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

## After day 1, in order

1. Stretch A (Pace): add the plan, calendar and note fixtures first.
2. Stretch B (Why), then C (Plan in), then D (Act with approval).
3. The full eval set of about 27 cases.
4. Langfuse, a fallback to another model, and the `orders/create` webhook if it was skipped.
5. The remaining metrics and storylines, the full 3,000-order dataset, and bulk operations.
