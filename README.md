# Oasis Pace

Oasis Pace is a Shopify app with an AI agent. You ask it questions about a store (sales, orders, stock, customers) in plain English, and every number in its answer is checked against a database query before you see it. On top of that sits Growth Capital's planning loop: load a client's plan, track pace against it, explain misses, and propose changes that a person approves. It is built as a module for Oasis, Growth Capital's platform.

- **Live app:** https://oasis-pace.vercel.app (sign in with the demo login sent with the submission)
- **Loom walkthrough:** added with the submission
- **Built with:** Next.js 16 (App Router, TypeScript) on Vercel, Clerk (organisations and roles), Neon Postgres with Drizzle, the Shopify Admin GraphQL API (version 2026-10), the Vercel AI SDK on Amazon Bedrock.
- **How it was built:** Claude Code drafted plans and code from my decisions; I reviewed and own every decision.

**Start here:** [Try it](#try-it-in-two-minutes) · [The idea](#the-idea) · [The brief, item by item](#the-brief-item-by-item) · [What is in the app](#what-is-in-the-app) · [How it works](#how-it-works) · [Decisions](#key-decisions-and-what-was-rejected) · [Evals](#evals) · [Run it yourself](#run-it-yourself) · [Where things are](#where-things-are) · [Glossary](#glossary)

New to the jargon (Oasis, SOW, MER, tenant, ledger)? The [glossary](#glossary) explains every term and every part of the app.

## Try it in two minutes

1. Open the live app and sign in with the demo login. If it is not already active, press Ctrl K and choose **Solenne** under "Switch brand". It is the larger demo store: a fictional skincare brand with about 1,000 orders.
2. Go to **Chat** and ask `What were our net sales in September 2026?` Figures the number checker traced are underlined. Click one to see the query behind it. The answer ends with "N of N figures traced".
3. Ask `How did the Gua Sha Stone launch go?`, or `Was last year's 25% Black Friday promotion worth it? I care about whether those customers came back within six months.`, or `Which products are bought together most often?`
4. Open **Pace** to see the month against the plan, with markers for calendar entries, call notes, new discount codes and possible stockouts.
5. Open **Segments** to see the customer map. Click a segment's legend entry or card to filter the top-customers table.
6. Press `?` for the keyboard shortcuts, or Ctrl K (Cmd K on a Mac) to ask a question from any page.

Two things to know before you read dates and approvals:

- The demo orders end on 31 October 2026. When the newest order is more than 36 hours old, the app treats the day after it as "today", so "last month" is October. A banner in Chat says so.
- Approvals from the reviewer logins are a dry run: they go through the whole approval flow and never touch a store.

## The idea

An agent that talks about money must not make numbers up. So the model never does arithmetic and never sees the database. It calls a small set of typed tools (one per question family), each bound to the signed-in brand and each returning figures with their definitions and a query id. A checker then reads the finished answer and rejects any number that is not in that turn's tool results; the model gets one chance to fix it, and what it cannot source is flagged on screen. Everything else follows from that: the data lives in Postgres so the numbers are reproducible and testable, the demo stores are seeded with known stories so the answers can be graded, and every write the agent proposes goes through an approval ledger.

## The brief, item by item

The brief asked for a test Shopify app, a test dev store and an AI agent that queries the data on demand, and listed four stretch ideas. Everything on that list is built, plus more.

| Brief item | Status | Where |
|---|---|---|
| Test Shopify app | Built | `shopify.app.toml`, OAuth install in `app/api/shopify/`, signed webhooks (`orders/create`, `app/uninstalled`, the three compliance topics) |
| Test dev store | Built | Two Plus dev stores (Solenne, Tidepool) seeded with 14 months of orders and known storylines (`scripts/seed/`, `fixtures/`) |
| AI agent that queries the data on demand | Built | `/chat`, `lib/agent/` (loop, tools, number checker); new orders arrive through the signed `orders/create` webhook and a nightly refresh |
| Stretch: generative UI and dashboarding | Built | `render_view` (KPI card, line, bar, table, gauge, waterfall, cohort heat grid, lift and dip, launch small multiples, bundle matrix), pinned views, `/overview`, `/pace` against plan, a customer map on `/segments` |
| Stretch: document parsing | Built | `/plan`: upload a SOW PDF or plan CSV, review the targets read from it with their page, confirm as the active plan. A supplier invoice (PDF) becomes unit-cost updates that a person approves, a call note becomes plan changes and action items, and `ask_document` answers questions about an uploaded document with the page it came from |
| Stretch: Shopify Liquid page generation | Built | `draft_landing_page`: copy from the model, Liquid built and checked on the server, approval card. Shopify lets an app write theme files only after an exemption, so an approved page is pushed with `npm run landing:push` (Shopify CLI) |
| Stretch: additional data sources | Built | Ad spend (MER, CAC), marketing calendar, call notes, plan targets, supplier invoices |
| Beyond the list | Built | Why a month missed plan (`explain_gap`), approved writes to Shopify (Metric Target, annotation, discount off, unit cost, customer segment), weekly brief, portfolio view, team memory, a growth audit (`/audit`), saved playbooks (`/playbooks`), cohort grids and unit economics, an EBITDA calculator with an editable cost sheet and what-if scenarios (`/ebitda`, `get_ebitda`, `get_ebitda_scenario`), promo post-mortems (`get_promo_postmortem`), bundle candidates (`get_bundle_candidates`), launch curves (`get_launch_curves`), retention segments with a Klaviyo CSV (`get_customer_segments`, `/segments`), data-health checks, an Overview home page, a store-health Connect page, colour schemes, optional Langfuse tracing and a fallback model |

### Every feature, what it does and what it changes

The table above is the index. Below, each brief item is broken into its features: what the feature does, and the impact it has for a team like Growth Capital's, a few senior operators looking after many brands.

#### Requirement 1: a test Shopify app

| Feature | What it does | Impact |
|---|---|---|
| OAuth install | A store owner approves the permissions once. The app keeps the access token encrypted and only the server ever uses it. | A brand connects in minutes without sharing a password, and the token never reaches the browser or the model. |
| Signed webhooks | `orders/create`, `app/uninstalled` and the three privacy topics arrive as HMAC-verified calls. | Only real Shopify messages are trusted, and a new order reaches the data between nightly refreshes. |
| Sync | Reads orders, products, customers and stock from Shopify in pages into Postgres. It runs nightly from a cron job and on demand with Resync. | Answers do not depend on Shopify's query-cost limits, so they are fast and repeatable. |
| Store health (`/connect`) | Shows the permissions Shopify granted, when the data was last synced, how much history is covered, and live checks of the connection. | Anyone can tell in seconds whether the data behind an answer is fresh and complete. |
| One brand per organisation | Each brand is a Clerk organisation, and the brand always comes from the signed-in session, never from the model or a request field. | One team can look after many brands without one brand's data reaching another. |

#### Requirement 2: a test dev store

| Feature | What it does | Impact |
|---|---|---|
| Two dev stores | Solenne (a fictional skincare brand, about 1,000 orders) and Tidepool (a fictional baby brand, about 100 orders), both Shopify Plus dev stores. | The app is shown on two brands of different size and shape, with no real customer data. |
| Planted storylines | The seeded orders hold known events: a bad batch that drove refunds, a leaked discount code, a budget cut. | The agent has real things to find, and each one has a known right answer to grade against. |
| Seeding scripts | `seed:generate`, `seed:load`, `seed:topup` and `seed:extra` build the orders, write them to a store, and add the days since. | The demo can be rebuilt, and kept current as the calendar moves. |
| `truth.json` and reconcile | The right answers are worked out apart from the app's code, and `npm run reconcile:truth` compares the synced numbers with them. | It shows the numbers are right, not just plausible. |

#### Requirement 3: an AI agent that queries the data on demand

| Feature | What it does | Impact |
|---|---|---|
| Chat with typed tools | The model calls one tool per question family (metrics, orders, customers, inventory, cohorts, unit economics and more). Each tool is bound to the signed-in brand. | Anyone can ask a question in plain English and get an answer from live store data, and the agent cannot reach another brand's. |
| 16 metrics, one definition each | Net sales, orders, AOV, refund rate, MER, CAC, gross margin, repeat rate, zero-sales days and others. The agent quotes the definition with the figure. | Two people asking the same question get the same number, and everyone knows what it means. |
| Number checker | Reads the finished answer and rejects any number that no tool returned. The model gets one repair turn, and what it still cannot source is flagged on screen. | The agent cannot make a figure up unnoticed, which is the main reason to trust an AI with money numbers. |
| Proof drawer and traced figures | Each traced figure is underlined with a source card, and an answer ends with "N of N figures traced". | A reader can verify any figure in two clicks instead of taking the agent's word. |
| Suggested questions, follow-up chips, saved threads, model picker | Starter questions, one-click next questions, conversations that can be reopened, and a choice of model. | New users know what to ask, and work can be picked up again. |
| Safe with store text | Order notes, product descriptions and uploaded documents reach the model as data, never as instructions. No name, email, phone or address is stored, and a test enforces it. | A note or a document cannot hijack the agent, and customers' personal details never reach the model. |
| Spend cap, audit log, fallback model, tracing | A daily spend limit per brand, a log of every turn and tool call, a second model if the first fails before streaming, and optional Langfuse traces. | Cost is bounded, every answer can be audited, and an outage on one model does not stop the chat. |

#### Stretch 1: generative UI and dashboarding

| Feature | What it does | Impact |
|---|---|---|
| Charts and tables in the chat | The agent draws KPI cards, line, bar and waterfall charts, gauges, tables, a cohort heat grid, lift and dip, launch small multiples and a bundle matrix from tool results. | The answer is a picture where a picture is clearer, and every plotted figure comes from a query. |
| Pinned views and pinned answers | A chart can be pinned to a brand, and a Ctrl K answer can be pinned as a card on Overview. | The questions people ask most become a dashboard without anyone building one. |
| Overview (`/overview`) | Net sales against plan, what needs attention, what waits for approval, the latest brief and pinned answers, with count-up numbers, sparklines and a "plan hit" badge. | One page to start the day: where the month stands and what needs a person. |
| Pace chart | Month to date against plan, with a lane of markers (calendar entries, call notes, new discount codes, possible stockouts) and a slider that replays the month day by day. | It shows what happened on the days the line bent, and what the plan gap looked like at any point in the month. |
| Customer map (`/segments`) | Recency against lifetime value, one shape per segment, and a legend that filters the top-customers table. | Retention work starts from who the customers are, not from a list. |
| Ctrl K palette and shortcuts | Jump to a page, switch brand, or ask a question from anywhere. `?` lists the shortcuts. | Moving around and asking take a keystroke. |
| Look and feel | Skeleton loaders on every data page, five colour schemes with light and dark, reduced-motion support, and a text alternative for every chart. | The app feels like a product and works for people who need accessibility settings. |

#### Stretch 2: document parsing

| Feature | What it does | Impact |
|---|---|---|
| SOW or plan sheet to plan (`/plan`) | Upload a SOW (PDF) or plan sheet (CSV), review the targets read from it with their page, and confirm them as the active plan. | A contract becomes a live plan through a review step instead of retyping, and a person confirms every figure. |
| Supplier invoice to unit costs | A PDF invoice becomes unit-cost updates matched to variants by SKU, each shown with old and new cost, and written to Shopify after approval. | Margin figures use current costs without hand entry. It has run end to end against a real store. |
| Call note to plan changes and action items | A call note becomes proposed plan changes and a list of follow-ups that show on Pace until marked done. | Decisions made on a call do not get lost. |
| Questions about a document | `ask_document` answers a question about an uploaded document and says which page the answer came from. | A long contract can be questioned instead of searched. |
| Two-pass reading | The model first finds statements and quotes the exact words, the server checks each quote is in the document, and only then are figures and dates structured. | The reader cannot invent a figure: a quote that is not in the document is dropped. |

#### Stretch 3: Shopify Liquid page generation

| Feature | What it does | Impact |
|---|---|---|
| Landing-page draft | Ask the agent for a landing page and the model writes only the copy. | The writing is quick, and the model has no way to change what the page does. |
| Server-built Liquid | The server builds the page from fixed templates and reads prices from Liquid objects. | A wrong typed price or a script tag in generated code is made impossible. |
| Checks | The page passes our own lint and Shopify's Theme Check before it reaches an approval card. | A broken page is caught before anyone sees it. |
| Approval and push | A person approves a card showing the exact page. Shopify lets an app write theme files only after an exemption, so an approved page is pushed with `npm run landing:push`. | A page never goes live without a person, and the action ledger records who approved it and when. |

#### Stretch 4: additional data sources

| Feature | What it does | Impact |
|---|---|---|
| Ad spend | Daily spend by channel, loaded from a file, feeds MER and new-customer CAC. | Efficiency questions can be answered beside sales questions. |
| Marketing calendar | Dated launches, promotions and sends feed the Pace markers and the evidence for "why". | A dip or a spike is explained by what the team did. |
| Call notes | Notes from client calls are read for plan changes and follow-ups. | Context from conversations reaches the numbers. |
| Plan targets | Monthly targets come from a SOW or a plan sheet. | Pace and the briefs measure against the agreed plan. |
| Invoices | Supplier invoices set unit costs. | Gross margin and payback rest on real costs. |

#### Beyond the list

| Feature | What it does | Impact |
|---|---|---|
| Pace (plan against actual) | A target is spread over the days using last year's pattern. A month-end estimate appears once five complete days exist, and "Need $X a day" says what each remaining day must sell. | A monthly target becomes a daily answer while there is still time to act. |
| Why a month missed plan (`explain_gap`) | Splits a finished month's gap into new and returning orders, their order values and refunds, then looks for evidence in the store data, the calendar and the call notes. | The post-mortem is drafted from evidence rather than from memory. |
| Approved writes | The agent can propose a Shopify target, an annotation, turning a discount off, a unit-cost change, a customer segment or a landing page. A person approves a card, the server runs it once, and the ledger records who and when. | The agent can act, not just talk, with a person in the loop and a record of every change. Approvals from reviewer logins are dry runs. |
| Weekly brief (`/briefs`) | Drafted every Monday through the same agent loop, blocked from approval if a number cannot be sourced, and approved by a person. | A client-ready summary is ready to review instead of written from scratch. |
| Portfolio (`/portfolio`) | Ranks brands by dollars behind plan, with the biggest driver of each. | One view tells a few operators which brand to look at first. |
| Growth audit (`/audit`) | Four fixed checks (stock risk, repeat rate, discount dependence, refund outliers) over the synced data, written up by the model through the number checker. | A new brand gets a health check on connection. |
| Playbooks (`/playbooks`) | A Black Friday review, a retention check and a monthly business review, each run with one click and stored per brand. | A repeatable review is one click, and the figures are checked like any answer. |
| Cohorts and unit economics | Repeat rate by first-order month, gross margin, contribution margin and payback from unit costs. | It shows whether acquiring customers pays back. |
| Promo post-mortems | Weighs a promotion's extra sales against the sales it only pulled forward, and how well its customers came back. | It shows whether a promotion created demand or only moved it. |
| Bundles and launch curves | Which products are bought together (with the share and lift), and a product's first weeks against the median launch. | Merchandising and launch decisions rest on order data. |
| Retention segments | Champions, at risk, due to reorder and one and done, scored by recency, frequency and value, with a Klaviyo CSV of pseudonymous ids. | It shows who to win back, and hands the list to an email tool. |
| Team memory | The agent keeps notes for a brand, such as why a month dipped, which a Growth Capital person confirms. | What the team learns survives from one conversation to the next. |
| Roles | Growth Capital staff see several brands, and a client viewer sees one brand, read only. | A client can look at their own numbers without seeing another brand or any write tool. |
| Evals | 40 cases ask the real model questions with known right answers and grade them with deterministic checks. | A change to the prompt or the model is tested instead of guessed. |

#### Beyond the list: the EBITDA calculator

| Feature | What it does | Impact |
|---|---|---|
| EBITDA by month (`/ebitda`) | Takes each month from net sales down to EBITDA in steps: less cost of goods, card fees, fulfilment and ad spend (what is left is profit after variable costs), then less operating costs. A waterfall chart draws one month, and every line names where its number comes from. | It shows whether a brand makes money after its running costs, and which line moved, not only whether sales were up. |
| Cost sheet | The costs Shopify does not hold (payroll, software, rent, contractors, other) by month, plus the card-fee and fulfilment rates. Both demo brands come with one. Growth Capital admins and partners edit it on the page and other roles read it. An edit saves at once, is stored with who made it and when, and never reaches Shopify. | The person who knows the real bill can correct a figure, and a month with no costs entered is flagged, not shown as zero. |
| What-if scenarios | Sliders for price, ad spend, product cost, order volume and operating costs show how EBITDA would change over the last three complete months. A target box works the other way: how many orders it would take to reach a chosen EBITDA. | A team can test "what if we cut ads by a fifth?" before acting, with the assumptions behind the answer in view. |
| The same figures in chat | `get_ebitda` and `get_ebitda_scenario` run on the same arithmetic as the page, so the number checker covers EBITDA answers like any other. | The page and the chat show the same figures, and the agent never works out a profit figure itself. |

**Try it:** on Solenne, open **EBITDA** in the sidebar for the monthly bridge, then pull the ad-spend slider down to -20% and read the line that says what the cut assumes. Or ask Chat `What was Solenne's EBITDA in August 2026, and what is it made of?` or `What happens to our profit if we cut ad spend by 20%?`

**Limits to know:**

- Card fees and fulfilment are assumed rates, not Shopify data: 2.9% of net sales plus 30 cents an order for card fees, and $4.50 an order for fulfilment. The page lists the rates under "Where each line comes from" and in the cost sheet, not beside the figures they produce.
- The demo cost sheets are invented, and small on purpose. From August to October 2026 Solenne's net sales averaged about $7,000 a month and Tidepool's about $1,000, so a realistic payroll would swamp them. Solenne's sheet has a software bill that creeps up each quarter, a part-time creative contractor from March 2026 and a one-off shoot in June 2026. In those three months Tidepool spent about 70% of its net sales on ads, and it is meant to show a loss.
- Cost of goods uses today's unit cost from Shopify for every sale, as unit economics does, not the cost on the day of the sale. Units sold on variants with no unit cost have no cost of goods here.
- When a month has no cost-sheet rows, or some units have no unit cost, costs are missing and the true EBITDA can only be lower than shown. That month is marked a **ceiling**, and the agent says so instead of presenting a firm figure. A month still running has its operating costs prorated by the days gone, and scenarios use complete months only.
- Scenarios rest on two assumptions, both stated beside the answer. A price change moves orders by a price elasticity of `-1.5`, so a 10% price rise loses 15% of orders. Cutting ad spend loses new-customer orders in proportion at today's cost to win a customer and leaves returning-customer orders alone; without that rule, cutting ads would always look free.

**A design, not built:** a QuickBooks or Xero connection (operating costs come only from the seeded sheet and from edits on the page) and a CSV upload for the cost sheet (the reader used for the seed files could serve one later). Tax, interest, depreciation and amortisation have no line, because EBITDA leaves them out by definition.

## What is in the app

**Ask**

- **Overview** (`/overview`, the home page): net sales this month against plan, what needs attention, what is waiting for approval (Growth Capital roles), the latest brief and a box to ask a question. A public landing page sits at `/`. Numbers count up on load, and net sales sparklines and a "plan hit" badge show how the month is going.
- **Chat** (`/chat`): suggested questions and follow-up chips, saved threads, a proof drawer on every figure that shows where it came from, "what the metrics mean", a model picker. Answers lead with the figure, say which period and which metric definition were used, and say when the data was last synced. Every figure the number checker traced is underlined with a card showing its source. The agent draws charts and tables in the chat (including a cohort heat grid of repeat customers), and works out gross margin, contribution margin and payback from unit costs.
- **Ctrl K palette** (everywhere): jump to a page, switch brand, or ask a question right there. The answer streams in and can be pinned as a card on Overview (kept in that browser only). `?` lists the keyboard shortcuts, and `g` then a letter jumps to a page.

**Track against the plan**

- **Pace** (`/pace`): month to date against the plan. A target is spread over days using last year's pattern for the same month, so Black Friday does not make November look behind for three weeks. Where the month will land is shown as an estimate once five complete days exist (before that one big day would swing it by thousands, so the screens, the chat and the brief all say it is too early), and "Need $X a day" says what each remaining day must sell to reach the target. A day-by-day chart and metric tiles show ahead or behind plan. The chart carries a lane of markers for calendar entries, call notes, new discount codes and possible stockouts, and a slider replays the month day by day with the plan gap recomputed as of that day.
- **EBITDA** (`/ebitda`): each month's bridge from net sales down to EBITDA, a waterfall for one month, receipts that say where every line comes from, what-if sliders for price, ads, product cost, volume and operating costs, and the cost sheet. Everyone who can open the brand can read it, and a Growth Capital admin or partner can edit the cost sheet. The agent reads the same figures through `get_ebitda` and `get_ebitda_scenario`. The assumptions and limits are [above](#beyond-the-list-the-ebitda-calculator).
- **Why** (`explain_gap`): splits a finished month's gap into new and returning orders, their average order values and refunds (a midpoint split, so the parts add up exactly), looks for evidence in the store data, the marketing calendar and the call notes, and writes the explanation. A client viewer's version uses store data only.
- **Portfolio** (`/portfolio`) and **Briefs** (`/briefs`): brands ranked by dollars behind plan with the biggest driver of each; a weekly brief drafted through the same agent loop, blocked from approval if the checker finds a number it cannot source.

**Bring documents in, and act**

- **Plan in** (`/plan`) and **Actions** (`/actions`): documents become plan targets, a supplier invoice becomes unit-cost updates (matched to variants by SKU, each shown with its old and new cost), and a call note becomes plan changes and action items that show on Pace until someone marks them done. The agent can also propose a Shopify target, an annotation, turning a discount code off, a unit-cost change, a customer segment or a landing page. Each proposal is a card with the exact change. A Growth Capital admin or partner approves, the server re-validates and runs it once, and the ledger records who and when.
- **Landing pages**: ask the agent for one and the model writes only the copy. The server builds the Liquid from fixed templates (prices are read from Liquid objects), checks it with its own lint and Shopify's Theme Check, and shows an approval card. Shopify lets an app write theme files only after an exemption request, so an approved page is finished with `npm run landing:push`.

**Analyse**

- **Segments** (`/segments`, Growth Capital roles only): the four retention segments (champions, at risk, due to reorder, one and done) with their counts, average lifetime value and days since the last order, a customer map of recency against lifetime value (one shape per segment, and the legend filters the table), and the top customers by pseudonymous id. Each segment downloads as a CSV for Klaviyo ([below](#export-for-klaviyo)), or can be proposed as a Shopify customer segment through the approval card. The agent reads the same numbers through `get_customer_segments`. Churn risk is a heuristic (days since the last order against the customer's own usual gap), not a prediction.
- **Merchandising and promotions** (in Chat): `get_bundle_candidates` says which products are bought together, with the orders that held both, the share and the lift. `get_launch_curves` shows a product's first weeks against the median launch, counting the first sale as the launch because there is no publish date. `get_promo_postmortem` weighs a promotion's extra sales against the sales it pulled forward, and how well its customers came back. They are drawn as a bundle matrix, small multiples and a lift-and-dip chart.
- **Audit** (`/audit`): a growth audit of a connected store, run on demand. The findings (stock risk, repeat rate, discount dependence and refund outliers) are fixed code over the synced data; the model only writes them up, through the same number checker. Ten-minute cooldown, because each run is a paid model call.
- **Playbooks** (`/playbooks`, Growth Capital roles only): three saved reviews, each run with one click. A Black Friday review, a retention check, and a monthly business review of a finished month against plan, with the cause of the gap and its source. Each is one fixed question, written on the server, sent through the same agent loop, so the number checker runs on the write-up. Every run is stored per brand. Each run is one paid model call, and a brand can run each playbook once per 10 minutes.
- **Connect** (`/connect`): store health. The permissions Shopify actually granted, when the data was last synced, how much history is covered, and real checks of the connection.

**Everywhere**

- **Settings** (`/settings`): five colour schemes (Sorbet is the default) and light, dark or match-my-device, saved in a cookie in your browser.
- Every data page has a skeleton loader, every animation stops under reduced motion, and every chart has a text alternative.
- **Roles:** `gc_admin` and `gc_partner` (Growth Capital staff, several brands) and `client_viewer` (one brand, read only: the chat with store data, the EBITDA page and the approved weekly briefs; no call notes, no write tools, no audit, no playbooks). The sidebar leaves out Portfolio, Audit, Playbooks, Plan and Actions for a client viewer, and those pages say they are for Growth Capital roles only if the link is typed.

### Export for Klaviyo

There is no Klaviyo account in this build, so a segment leaves Oasis as a CSV. `/segments` has a download link per segment, and the same file comes from `GET /api/segments/export` (add `?segment=at_risk` for one segment; with none, the four segments together, leaving out customers in none of them). Only Growth Capital admins and partners can download it, and the brand comes from the session.

The columns are `customer_id`, `segment`, `orders`, `ltv`, `days_since_last_order`, `r`, `f` and `m`. `ltv` is lifetime value in dollars with two decimals, net of discounts and refunds; `r`, `f` and `m` are the recency, frequency and monetary scores from 1 to 5. Customers are pseudonymous ids (`CUST_` and a hash), so the file has no emails.

How a live sync would work (a design, not built): with protected customer data access from Shopify, a service in Oasis would map each pseudonym back to a Shopify customer, on the server and outside the agent, which never sees an email. It would then push each segment to Klaviyo as a list, through Klaviyo's API or its Shopify integration, and refresh the list whenever the segments are recomputed. Pushing a list is a write, so it would go through the same approval card as the other writes.

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
      read tools          view / memory tools       Why · Act · Landing tools
   query_metric …         render_view · remember    explain_gap · propose_action …
          │                                              │
          ▼                                              ▼
   Postgres (synced from Shopify)               Action ledger ──▶ Shopify (after approval)
          ▲
   Shopify Admin GraphQL (paged sync, daily cron, orders/create webhook)
```

- **Data:** Shopify is synced into Postgres (every table has `tenant_id` first), so answers do not depend on Shopify's query-cost limits and the metric layer can be tested against `truth.json`. Customers are pseudonymous ids; no name, email, phone or address column exists, and a test enforces it.
- **Metrics** (`lib/metrics/`): money is integer cents, rates are fractions, every metric has one definition that the agent quotes. Wholesale orders are tagged and can be left out; ad spend is never filtered by order filters.
- **Number checker** (`lib/agent/checker.ts`): builds a ledger from the turn's tool results (cents become dollars, fractions become percentages), reads every number in the answer, and ignores dates, ids, list numbers and product names. Unmatched numbers trigger one repair turn.
- **Documents:** a SOW, an invoice or a call note is read in two passes. The model first finds statements and quotes the exact words, the server checks every quote is really in the document, and only then are the figures and dates structured. A quote that is not in the document is dropped, and a figure the quote does not state is refused.
- **Untrusted text:** order notes, product descriptions, calendar entries, call notes and uploaded documents are data under an `untrusted` key. The prompt says so, the checker never takes a figure from them, and the evals include two injection cases.
- **Tenancy:** the tenant comes from the Clerk session (webhooks: the HMAC-verified shop; cron: `CRON_SECRET`). No tool schema has a tenant, shop or user field.
- **Writes:** the model never writes GraphQL or Liquid. Proposals are typed fields; the server builds the mutation (user text only in variables) and the page (fixed templates, prices read from Liquid objects, then our lint and Shopify's Theme Check). The ledger stores the payload and its hash, and an approval re-checks both and moves proposed to running in one conditional update, so a double click runs once. A write is never retried after a 5xx, because it may already have committed.
- **Operations:** if the chat model times out, throttles or returns a 5xx before any text has streamed, the turn moves once to a fallback model and carries on from the tool steps already done. Spend is capped per brand per day. Langfuse tracing is opt-in (three environment variables, inert without them) and records only the tenant id, route, model, tool names, timings and token counts, never prompts, answers or tool results.

## Key decisions, and what was rejected

| Decision | Rejected | Why |
|---|---|---|
| Sync Shopify into Postgres and query that | Live GraphQL on every question; text-to-SQL | Query-cost limits and slow answers; text-to-SQL cannot guarantee a metric's definition or the tenant filter |
| Typed tools per question family | One generic query tool | Strict schemas with no tenant field are the authorization boundary |
| A number checker on the answer | Trusting the model; asking it to show its work | Checks the thing that matters (the figures), cheaply, on every answer |
| Seeded storylines (a bad batch, a leaked code, a budget cut) | Shopify's generated data | The agent has real things to find, and they are the ground truth for the evals |
| Standalone app with Clerk | Embedded Shopify admin app | Mirrors how Oasis is built; reviewers use a URL without Shopify admin access |
| Approval ledger for every write, dry run for reviewers | Letting the agent write directly | The demo is the same for every reviewer, and nothing reaches a store without a person |
| Documents read in two passes: find and quote, then structure | One call that reads and structures | A quote that is not in the document is dropped, and a figure or date the quote does not state is refused, so the reader cannot invent one |
| Model writes copy only for landing pages | Model writes Liquid | A typed price or a script tag in generated Liquid is a real risk; the server makes it impossible |

The reasoning is recorded as short decision records in [docs/decisions/](docs/decisions/).

## Evals

`npm run eval` asks the real model each case's question against the fixture data (an in-memory database, today's date pinned) and grades the answer with deterministic checks: the expected figures come from the dataset and the fixture files, never from the code under test. Results are written to [docs/evals/latest.md](docs/evals/latest.md).

The full run on the default model, Claude Sonnet 4.6 (2026-11-02, all 38 cases): **32 of 38 cases pass**, at an estimated $4.75.

| Category | Passed | Cost |
|---|---|---|
| plan | 2 of 2 | $0.27 |
| memory | 1 of 1 | $0.17 |
| ads | 0 of 1 | $0.13 |
| why | 3 of 5 | $0.82 |
| lookup | 5 of 5 | $0.42 |
| comparison | 2 of 3 | $0.35 |
| storyline | 2 of 3 | $0.40 |
| injection | 2 of 2 | $0.17 |
| privacy | 1 of 1 | $0.04 |
| isolation | 1 of 1 | $0.08 |
| landing | 1 of 1 | $0.25 |
| cohorts, unit economics | 2 of 2 | $0.22 |
| documents, audit | 4 of 4 | $0.52 |
| promo post-mortems, retention segments, merchandising | 5 of 5 | $0.64 |
| playbooks | 1 of 2 | $0.26 |

The cases cover lookups, comparisons, planted storylines, "why did we miss plan" diagnoses for each storyline, Pace, prompt injection, a refused request for a customer's email, a Tidepool user asking about Solenne, landing pages, cohorts and payback, invoices, document questions, call notes, the audit, promo post-mortems, segments, bundles, launch curves and playbooks. The suite also tells models apart: the same cases on Devstral 2 passed far fewer. Per-case answers and costs are in [docs/evals/latest.md](docs/evals/latest.md), and notes on each case that did not pass are in [docs/evals/notes.md](docs/evals/notes.md).

## Run it yourself

You need Node 22 or newer and npm (plus the Shopify CLI to deploy). Accounts: Shopify Dev Dashboard, Clerk, Neon, Vercel and AWS Bedrock. Copy `.env.example` to `.env.local` and fill it in; [docs/runbook.md](docs/runbook.md) says where each value comes from. Then:

```
npm ci
npm run db:migrate
npm run fixtures:load      # plan, ad spend, cost sheet, calendar and call notes
npm run dev
```

Local runs, scripts and the deployed app share one Neon database. Connect and reconnect stores on the deployed app, because Shopify's OAuth redirect is the production callback. Pushing to `main` deploys to Vercel.

**[paid]** marks a command that calls the model and costs money. **[live]** marks one that writes to a real Shopify store.

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Run, build and serve the app |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint checks |
| `npm test` | The test suite (about 100 seconds; it uses an in-memory Postgres and needs no secrets) |
| `npm run eval` **[paid]** | The eval suite against the real model; add `-- --case <id>` for one case |
| `npm run db:migrate` | Apply the SQL migrations in `drizzle/` to the database |
| `npm run fixtures:load` | Load each brand's plan, ad spend, cost sheet, marketing calendar and call notes |
| `npm run tenant:create -- --org <clerkOrgId>` | Add a brand for a Clerk organisation |
| `npm run chat:try -- --store solenne --q "..."` **[paid]** | Ask the real agent one question from the terminal |
| `npm run reconcile:truth` | Compare the synced numbers with `truth.json` |
| `npm run seed:generate` | Generate the demo orders (deterministic) |
| `npm run seed:load` **[live]** | Write the generated orders to a dev store (slow: dev stores take five new orders a minute) |
| `npm run seed:topup -- --store solenne\|tidepool\|all` **[live]** | Add generated orders for the complete days since the first load |
| `npm run seed:extra -- --store solenne\|tidepool` **[live]** | Add three hand-picked orders dated 1 November |
| `npm run landing:push -- <action id>` | Finish an approved landing page through the Shopify CLI |
| `npm run plan-in:try` **[paid]** | Read the fixture SOW with the real model and print the targets next to the expected ones |
| `npm run themes:build` | Regenerate `app/themes.css` after changing a colour palette |

Everything else, including connecting a store, syncing, adding a brand, the reviewer logins and deploying, is in [docs/runbook.md](docs/runbook.md).

## Where things are

| Folder | What is in it |
|---|---|
| `app/` | Next.js routes. Pages are in `app/(app)/` (one folder per page), sign-in in `app/(auth)/`, and server endpoints in `app/api/` (chat, sync, webhooks, cron, documents, actions and more) |
| `components/` | The React UI: one folder per page, plus shared `ui/` and `shell/` |
| `lib/agent/` | The agent: loop (`run.ts`), prompt, model registry, number checker (`checker.ts`), spend cap, fallback model and tool wiring |
| `lib/tools/` | The read tools the agent calls, one file per question family |
| `lib/metrics/` | The metric registry (one definition per metric) and the queries behind it |
| `lib/shopify/`, `lib/sync/` | Shopify client, OAuth, webhooks and scopes; the paged sync, nightly refresh and `orders/create` |
| `lib/pace/`, `lib/why/`, `lib/overview/`, `lib/portfolio/` | Plan-versus-actual maths, the "why" explanation, the Overview data, the portfolio ranking |
| `lib/plan-in/`, `lib/call-notes/`, `lib/action-items/`, `lib/memory/` | Document reading, call notes, follow-ups and team memory |
| `lib/actions/`, `lib/landing/` | The approval ledger and the executors that write to Shopify; landing-page building and checks |
| `lib/briefs/`, `lib/playbooks/`, `lib/audit/`, `lib/segments/`, `lib/health/`, `lib/ebitda/` | The weekly brief, playbooks, the growth audit, retention segments, store-health checks, the EBITDA cost sheet and monthly figures (the arithmetic itself is `lib/metrics/ebitda.ts`) |
| `lib/views/`, `lib/threads/`, `lib/shell/`, `lib/appearance/` | Charts the agent draws and pinned views, saved threads, the palette and shortcuts, colour schemes |
| `lib/db/`, `drizzle/` | Database schema and client, the in-memory test database, and the SQL migrations |
| `lib/tenancy/`, `lib/crypto/`, `lib/ops/` | Tenant from the session, token encryption, Langfuse tracing |
| `scripts/` | Command-line tools: migrate, seed, reconcile, `chat:try`, `landing:push`, `tenant:create` |
| `fixtures/` | Demo data per brand: orders, `truth.json`, plan, ad spend, cost sheet, calendar, call notes, invoice and SOW |
| `evals/` | The eval cases, graders and runner |
| `docs/` | Product plan, implementation plan, build plan, priorities, runbook, decision records, eval results, and the production design |

## Glossary

[The product and the people](#the-product-and-the-people) · [Shopify and the data](#shopify-and-the-data) · [Metrics](#metrics) · [The agent](#the-agent) · [Plans and pace](#plans-and-pace) · [Acting, with approval](#acting-with-approval) · [Pages and parts of the app](#pages-and-parts-of-the-app) · [Quality and operations](#quality-and-operations)

### The product and the people

| Term | What it means |
|---|---|
| **Growth Capital (GC)** | The growth agency that set this exercise. A small group of senior operators runs growth for many premium consumer brands at once. |
| **Oasis** | Growth Capital's own platform. Oasis Pace is built as a module that could slot into it, on a matching stack (Next.js on Vercel, with Clerk). |
| **Oasis Pace** | This project: the Shopify app, the agent and the planning loop around it. "Pace" is also one of its pages. |
| **Brand (tenant)** | One client: a Shopify store plus its plan, notes and history. "Tenant" is the technical word. Every table starts with `tenant_id`, and the brand always comes from the signed-in session, never from the model or a request field. |
| **Solenne, Tidepool** | The two demo brands, each a Shopify dev store. Solenne is a fictional premium clean-skincare brand with about 1,000 orders. Tidepool is a fictional baby brand with about 100. |
| **Storyline** | An event planted in the demo data (a bad batch that drove refunds, a leaked discount code, a budget cut) so the agent has real things to find and the evals have a known right answer. |
| **Clerk** | The sign-in service. A Clerk organisation is a brand, and a member's role in it decides what they can see and do. The instance is invite-only. |
| **`gc_admin`, `gc_partner`** | Growth Capital staff who can see several brands. Both can chat, read Pace, propose and approve actions, upload plans, approve briefs and edit the EBITDA cost sheet. Only `gc_admin` connects stores. |
| **`client_viewer`** | A client who sees one brand, read only: the chat with store data, Pace, EBITDA and the approved weekly briefs. |
| **Reviewer login** | A demo account for people reviewing this work: one `gc_partner` in both brands and one `client_viewer` in Solenne. Approvals made from a reviewer login are dry runs that never touch a store. |

### Shopify and the data

| Term | What it means |
|---|---|
| **Shopify app** | The app installed in a store. It holds the permissions the store owner granted and an access token, which is kept encrypted (AES-256-GCM). |
| **Dev store** | A free Shopify test store with no real customers. This project uses two Shopify Plus dev stores. |
| **OAuth install** | The "approve these permissions" step where a store owner connects the app. It runs on the deployed app. |
| **Scopes** | The permissions the app asked Shopify for, such as reading orders or writing analytics annotations. The Connect page shows what was actually granted. |
| **Admin GraphQL API** | Shopify's API for reading and writing store data (version 2026-10). Only the server calls it, never the browser or the model. |
| **Webhook** | A message Shopify sends when something happens in the store: `orders/create`, `app/uninstalled` and three privacy topics. Each is checked with an HMAC signature before it is trusted. |
| **HMAC** | A signature that proves a message came from Shopify and was not changed on the way. |
| **Sync** | Copying orders, products, customers and stock from Shopify into Postgres. It reads in pages, runs nightly from a cron job, and can be started with Resync on Connect. A new order also arrives through the `orders/create` webhook. |
| **Cron job** | A scheduled call to the app. The nightly refresh and the Monday brief run this way, and each checks a `CRON_SECRET`. |
| **Postgres (Neon), Drizzle** | The database the app reads (hosted on Neon) and the tool that defines its tables and migrations (`drizzle/`). |
| **Pseudonymous customer id** | A customer is stored as `CUST_` plus a hash. There is no name, email, phone or address column, and a test enforces that. |
| **Seeding** | Filling a dev store with demo orders. `seed:generate` makes them, `seed:load` writes them to Shopify, `seed:topup` adds the days since, and `seed:extra` adds a few hand-picked orders. |
| **Fixtures** | The demo files for each brand in `fixtures/`: orders, plan, ad spend, cost sheet, marketing calendar, call notes, an invoice and a SOW. |
| **`truth.json`** | The known right answers for the demo data, worked out apart from the app's code. The reconcile script and the evals check against it. |
| **Reconcile** | `npm run reconcile:truth` compares what the app computes from the synced data with `truth.json`. |
| **Demo clock** | The seeded orders end on 31 October 2026. If the newest order is more than 36 hours old, the app treats the day after it as "today", so "last month" and "this month" stay meaningful. |

### Metrics

Money is stored as integer cents and rates as fractions (0.18 means 18%). Every metric has one definition, and the agent quotes it with the figure. "What the metrics mean" in Chat lists them.

| Term | What it means |
|---|---|
| **Gross sales** | Quantity times list price on every order line, before discounts, for orders placed in the period. Cancelled orders are left out. |
| **Discounts** | Discounts applied to the order lines. |
| **Refunds** | The value of refunded items, counted on the day the refund was made. |
| **Net sales** | Gross sales minus discounts minus refunds, in the same period. |
| **Orders, units sold** | The number of orders placed in the period (cancelled orders left out), and the total quantity on their lines. |
| **AOV (average order value)** | Gross sales minus discounts, divided by the number of orders. Refunds are not taken off. |
| **New-customer orders** | Orders that are the customer's first order ever in the store. |
| **Returning-customer rate** | Of the customers who ordered in the period, the share who placed at least one order that was not their first ever. |
| **Refund rate** | Units refunded from orders placed in the period, divided by units sold in the period. A later refund counts in the order's month. |
| **Discounted-order share** | The share of orders that used a discount code. |
| **MER (marketing efficiency ratio)** | Net sales divided by ad spend on all channels. 2.5 means $2.50 of net sales for each $1 of ads. |
| **CAC (customer acquisition cost)** | Ad spend on all channels divided by the number of new-customer orders: what each first order cost in ads. |
| **Gross margin** | Net sales minus unit cost times the units kept, divided by net sales. It uses today's unit cost from the product catalogue, and variants with no unit cost are left out. |
| **Contribution margin** | Net sales minus the cost of goods minus ad spend, per month, also shown as a share of net sales. |
| **Payback** | How many months it takes a month's new customers to earn back what they cost to win: the first month where their cumulative gross margin covers the ad spend. |
| **EBITDA** | Earnings before interest, tax, depreciation and amortisation (the yearly write-down of equipment and other long-lived purchases): what a business makes from trading before those items. Here it is net sales minus cost of goods, card fees, fulfilment, ad spend and operating costs, month by month. There is no line for interest, tax, depreciation or amortisation, which is what the name means. |
| **Profit after variable costs** | Net sales minus cost of goods, card fees, fulfilment and ad spend: what is left from sales before operating costs, and the subtotal just above EBITDA. It is not called contribution margin, because that name already means net sales minus cost of goods minus ad spend (above), and two meanings under one name would let a figure be read the wrong way. |
| **Ceiling (EBITDA)** | An EBITDA figure that can only be too high. A month is marked a ceiling when no operating costs were entered for it, or when some units sold have no unit cost, so costs are missing and the true figure can only be lower. The page and the agent say so instead of showing a firm number. |
| **Repeat rate** | The share of a cohort that orders again within 30, 60 or 180 days of the first order. |
| **Cohort, cohort grid** | A cohort is the customers whose first order fell in one month. The grid is a heat map of how many of each cohort ordered again, month by month. |
| **Zero-sales days** | Days with no sales for a variant that averaged at least 0.5 units a day over the previous 28 days: a suspected stockout. |
| **Wholesale** | Large wholesale orders are tagged and can be left out of a metric, so one big order does not distort an average. |
| **Lifetime value (LTV)** | What a customer has spent in total, net of discounts and refunds. |
| **RFM** | Recency, frequency, monetary: each customer is scored 1 to 5 on how recently, how often and how much they bought. |
| **Retention segment** | A group of customers by buying pattern: champions, at risk, due to reorder, and one and done. |
| **Churn risk** | A heuristic, not a prediction: days since a customer's last order against their own usual gap between orders. |
| **Promo post-mortem** | A look back at a promotion: its extra sales against the sales it only pulled forward, and how well its customers came back. |
| **Lift and dip** | The post-mortem chart: the rise in sales during a promotion and the dip after it, when some of those buyers would have bought anyway. |
| **Bundle candidates, lift** | Products bought together: the orders that held both, their share, and the lift, which is how many times more often the pair is bought together than chance alone would give. |
| **Launch curve** | A product's first weeks of sales set against the median launch. The first sale counts as the launch because there is no publish date. |
| **What-if scenario** | A test of "what if" on the last few complete months: move one or more levers (price, ad spend, product cost, order volume, operating costs, each as a share such as -20%) and EBITDA is worked out again. It is arithmetic on recent months, not a forecast. |
| **Price elasticity** | How far the number of orders moves when the price moves. The calculator assumes `-1.5`, so a 10% price rise loses 15% of orders. It is an assumption you can change, not something learned from this data. |

### The agent

| Term | What it means |
|---|---|
| **Agent** | The model plus its tools, in a loop: it reads a question, calls tools, then writes an answer. It never sees the database and never does arithmetic. A turn has at most 8 steps and a 90-second limit. |
| **Model** | Claude Sonnet 4.6 on Amazon Bedrock by default. The chat has a model picker: Devstral 2, Kimi K3 and MiniMax M2.5 are also selectable. |
| **Vercel AI SDK** | The library that runs the tool loop and streams the answer to the browser. |
| **Tool** | A typed function the agent can call, such as `query_metric`, `get_orders`, `get_cohorts` or `get_promo_postmortem`. Each is bound to the signed-in brand, and no tool takes a tenant, shop or user argument. |
| **Tool result** | What a tool returns: the figures, plus a query id, the date range, the metric definitions, an "as of" time and any caveats. |
| **Query id** | A short id on each tool result so a figure in an answer can be traced to the query behind it. |
| **Number checker** | Reads the finished answer and rejects any number that is not in that turn's tool results. It ignores dates, ids, list numbers and product names. |
| **Repair turn** | The one extra chance the model gets to fix an answer the number checker rejected. A number it still cannot source is flagged on screen. |
| **Proof drawer, traced figure** | The Chat panel that lists each figure and where it came from. A traced figure is underlined; click it for a source card. Each answer ends with "N of N figures traced". |
| **Caveat** | A plain-language note a tool adds to its result, for example that a product name was matched to product ids. |
| **View (`render_view`)** | A chart or table the agent draws in the chat from tool results: KPI card, line, bar, table, gauge, waterfall, cohort heat grid, lift and dip, launch small multiples or bundle matrix. A person can pin one to the brand. |
| **Thread** | A saved conversation. |
| **Suggested questions, follow-up chips** | Starter questions on an empty chat, and one-click next questions under an answer. |
| **Memory** | Notes the agent keeps for a brand with the `remember` tool, such as why a month dipped. A Growth Capital person confirms a note, and client viewers can read the confirmed ones. |
| **Untrusted data** | Order notes, product descriptions, calendar entries, call notes and uploaded documents reach the model as data under an `untrusted` key. The prompt says to treat them as data and never as instructions, and the checker never takes a figure from them. |
| **Prompt injection** | Text in the store or a document that tries to give the model orders. Two eval cases try it. |
| **Spend cap** | A daily limit on model spend per brand (`TENANT_DAILY_BUDGET_USD`, $5 by default, per UTC day). Chat warns at 80% and stops at 100% until midnight. |
| **Audit log** | One row per agent turn (model, tokens, cost, status) and one per tool call. Prompts, answers and tool results are not stored. |
| **Fallback model** | If the chat model times out, is throttled or fails before any text streams, the turn moves once to a second model and carries on. |
| **Langfuse** | An optional tracing service, off unless three environment variables are set. It records only the tenant id, route, model, tool names, timings and token counts. |

### Plans and pace

| Term | What it means |
|---|---|
| **Plan** | A brand's monthly targets, loaded from a SOW or a plan sheet and confirmed by a person. |
| **Target** | A number a brand should hit in a month, such as net sales of $X in November. |
| **SOW (statement of work)** | The document a client and Growth Capital sign: what work will be done, for how long, for what fee and what results are expected, including targets. |
| **Plan sheet** | A CSV of monthly targets, used instead of a SOW. |
| **Pace** | Month to date against the plan. A target is spread over the days using last year's pattern for the same month, so Black Friday does not make November look behind for three weeks. |
| **Complete day** | A store-local day that has finished. Pace counts only complete days, never today. |
| **Month-end estimate** | Where the month will land at the current rate. It appears once five complete days exist; before that the screens say how many days it needs. |
| **Need $X a day** | What each remaining day must sell to reach the month's target. |
| **Plan hit** | A badge that shows when the month's net sales have reached the month's target. |
| **Timeline marker** | A mark on the Pace chart for a calendar entry, a call note, a new discount code or a possible stockout. |
| **Replay slider** | Moves the Pace chart back through the month day by day, with the plan gap recomputed as of that day. |
| **Why (`explain_gap`)** | The explanation of a finished month's miss: new against returning orders, their order values and refunds, plus evidence from the store data, the calendar and the call notes. |
| **Marketing calendar** | Dated events (launches, promotions, sends) that the agent can use as evidence. |
| **Ad spend file** | Daily ad spend per channel, loaded from a file because it does not come from Shopify. It feeds MER and CAC. |
| **Cost sheet** | A brand's operating costs by month and category (payroll, software, rent, contractors, other), with the card-fee and fulfilment rates. Shopify does not hold these, so they sit in two small tables in the app's database, loaded from a file for each brand and editable by Growth Capital admins and partners. The demo brands' sheets are invented and small. Reloading the file never overwrites a cell a person has edited. |
| **Call note** | Notes from a client call. They become plan changes and action items. |
| **Action item** | A follow-up from a call note. It shows on Pace until someone marks it done. |

### Acting, with approval

| Term | What it means |
|---|---|
| **Proposal (approval card)** | A change the agent suggests, shown as a card with the exact change. The model never writes GraphQL or Liquid: proposals are typed fields and the server builds the change. |
| **Action ledger** | The record of every proposal: its payload and hash, who approved it and when. An approval re-checks both and moves the action from proposed to running in one conditional update, so a double click runs once. |
| **Dry run** | An approval from a reviewer login. It runs the whole flow and never touches a store. |
| **Metric Target** | A target set in Shopify's own Metric Targets feature. One of the writes the agent can propose. |
| **Annotation** | A note on Shopify's analytics charts. One of the writes the agent can propose. |
| **Discount off** | Turning a discount code off. One of the writes the agent can propose. |
| **Unit-cost update** | A change to a variant's unit cost. A supplier invoice (PDF) becomes these, matched to variants by SKU and shown with the old and new cost. |
| **Shopify segment** | A Shopify customer segment created from a retention segment through an approval card. |
| **Landing page** | A page the agent drafts. The model writes only the copy; the server builds the page from fixed templates. |
| **Liquid** | Shopify's template language for theme pages. |
| **Theme Check** | Shopify's checker for theme code. Landing pages pass it, and our own lint, before they reach an approval card. |
| **Theme-write exemption** | Shopify lets an app write theme files only after an exemption request. Until then, `npm run landing:push` finishes an approved page through the Shopify CLI. |
| **Klaviyo CSV** | An export of a retention segment as pseudonymous customer ids, for the email tool Klaviyo. |

### Pages and parts of the app

| Page | What it is |
|---|---|
| `/` | The public landing page. |
| **Overview** `/overview` | The home page: net sales against plan, what needs attention, what waits for approval, the latest brief and pinned answers. |
| **Chat** `/chat` | Ask the agent anything about the store. Saved threads, proof drawer, charts, model picker. |
| **Pace** `/pace` | The month against the plan, with the chart, markers, replay slider and "Need $X a day". |
| **EBITDA** `/ebitda` | Each month's bridge from net sales to EBITDA, a waterfall for one month, where each line comes from, what-if sliders and the cost sheet. Every role can read it. Growth Capital admins and partners can edit the cost sheet. |
| **Plan** `/plan` | Upload a SOW (PDF) or plan sheet (CSV), review the targets read from it, and confirm them as the active plan. Growth Capital roles only. |
| **Actions** `/actions` | The approval cards and the action ledger. Growth Capital roles only. |
| **Portfolio** `/portfolio` | Brands ranked by dollars behind plan, with the biggest driver of each. Growth Capital roles only. |
| **Briefs** `/briefs` | The weekly brief for each brand, drafted every Monday at 06:00 UTC and approved by a person. The number checker runs on it, and a brief with a number it cannot source is blocked. Clients read the approved ones. |
| **Audit** `/audit` | A growth audit of a store: stock risk, repeat rate, discount dependence and refund outliers. Growth Capital roles only. |
| **Playbooks** `/playbooks` | Saved reviews run with one click: Black Friday, retention check, monthly business review. Growth Capital roles only. |
| **Segments** `/segments` | Retention segments, the customer map, the top customers table and the Klaviyo CSV. Growth Capital roles only. |
| **Connect** `/connect` | Store health: granted permissions, last sync, history covered, connection checks, and Resync. |
| **Settings** `/settings` | Colour scheme and light or dark mode. |
| **Ctrl K palette** | Jump to a page, switch brand, or ask a question from anywhere. `?` lists the shortcuts. |

### Quality and operations

| Term | What it means |
|---|---|
| **Test suite** | Vitest tests for the calculations, tools, approvals, tenant isolation and screens. Tests that need a database use an in-memory Postgres (PGlite), so no secrets are needed. CI runs typecheck, lint and the tests on every push to `main` and on pull requests. |
| **Eval** | A fixed question with a deterministic grader, asked to the real model against the fixture data. `npm run eval` runs them, and the results are committed in `docs/evals/`. |
| **Grader** | The check an eval applies. Expected figures come from the dataset and fixture files, never from the code under test. |
| **Decision record (ADR)** | A short note on why a choice was made and what was rejected, in `docs/decisions/`. |
| **Runbook** | [docs/runbook.md](docs/runbook.md): how to set up, run, seed, sync, add a brand, deploy and fix common problems. |
| **Migration** | A SQL change to the database schema, in `drizzle/`, applied with `npm run db:migrate`. |
| **Vercel** | Hosts the app. A push to `main` deploys it. |
| **Production design** | How this would become a live Oasis module: [docs/production/](docs/production/). |

## More

[ROADMAP.md](ROADMAP.md) lists what is built, what comes next and what production would add. The thinking behind the build is in [docs/product-plan.md](docs/product-plan.md), [docs/implementation-plan.md](docs/implementation-plan.md), [docs/priorities.md](docs/priorities.md) and [docs/build-plan.md](docs/build-plan.md).
