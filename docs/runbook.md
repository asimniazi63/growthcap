# Runbook

How to operate Oasis Pace: set it up, run it, load data, sync, add a brand, deploy and fix common problems. The reasons behind choices are in [decisions/](decisions/). Build order is in [priorities.md](priorities.md).

**[paid]** marks a step that calls the model (it costs money). **[live]** marks a step that writes to Shopify or another real service. `CLAUDE.md` says to get the owner's go-ahead before `shopify app deploy`, uninstalling an app, `vercel --prod` and `npm run seed:load`.

## 1. First-time setup

Needs Node 22 or newer, npm, and the Shopify CLI (for deploys). Accounts: Shopify Dev Dashboard (two apps and two dev stores), Clerk, Neon, Vercel, AWS Bedrock. The values already chosen (shop domains, Clerk org ids, regions) are in [decisions/0000-setup.md](decisions/0000-setup.md).

Copy `.env.example` to `.env.local` and fill it in. `.env.local` is never committed. Names only below.

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk dashboard, API keys (development instance) |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | Copy the values in `.env.example` |
| `DATABASE_URL` | Neon, the pooled connection string |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | Dev Dashboard, Oasis Pace app, Settings, Credentials |
| `SHOPIFY_APP_URL` | The deployed URL (OAuth uses its host name) |
| `SEEDER_CLIENT_ID`, `SEEDER_CLIENT_SECRET` | Dev Dashboard, Oasis Pace Seeder app. Local seeding only: never put them on Vercel |
| `SOLENNE_SHOP_DOMAIN`, `TIDEPOOL_SHOP_DOMAIN` | The stores' `.myshopify.com` domains. Scripts use them to find the brand |
| `TOKEN_ENCRYPTION_KEY` | You make it: `openssl rand -base64 32`. Seals Shopify tokens (AES-256-GCM) |
| `CRON_SECRET` | You make it: `openssl rand -hex 32`. The cron routes check it |
| `AWS_BEARER_TOKEN_BEDROCK` | A Bedrock API key (AWS console). The AI SDK reads it itself |
| `AWS_REGION` | In `.env.example`, but no code reads it. Each model's region is set in `lib/agent/models.ts` |
| `BEDROCK_CLAUDE_ENABLED` | Optional. `true` switches on the Claude models (section 8) |
| `TENANT_DAILY_BUDGET_USD` | Optional. Model spend cap per brand per UTC day (section 8) |
| `REVIEWER_USER_IDS` | Optional. Clerk user ids of the reviewer logins, comma separated (section 10) |
| `LANGFUSE_*` | Not used yet |

Use the same `TOKEN_ENCRYPTION_KEY` locally and on Vercel. Both read tokens stored in the one database. If it changes, stored tokens can't be read and each store must be reconnected.

## 2. Running locally

```
npm ci
npm run db:migrate     # section 3
npm run dev
```

There is one Neon database. `npm run dev`, the scripts and the deployed app all use it, so a local change is a change to live data. The app's only allowed OAuth redirect is the production callback (`shopify.app.toml`), so connect and reconnect stores on the deployed app, not on localhost.

Checks before handing work over: `npm run typecheck`, `npm run lint`, and `npx vitest run <files>` for the files you changed. The full `npm test` takes about a minute (three workers, set in `vitest.config.ts`) and is run once at the end of a ticket. CI runs typecheck, lint and `npm test` on pushes to `main` and on pull requests, with no secrets.

## 3. Database

- The schema is `lib/db/schema.ts`. Migrations are SQL files in `drizzle/` (`0000` to `0008`).
- `0008` adds `playbook_runs` (T18, additive). Apply it with `npm run db:migrate` before deploying the Playbooks page.
- After a schema change: `npm run db:generate` writes a new SQL file (commit it), then `npm run db:migrate` applies every pending file to `DATABASE_URL` and prints the host.
- Migrations run by hand. Neither CI nor a deploy runs them. Migrate before you deploy code that needs the change.
- Neon runs Postgres 18. Tests run PGlite, an in-memory Postgres, so avoid features only Postgres 18 has (such as `uuidv7()`).
- Tests that need a database call `createTestDb()` (`lib/db/test-db.ts`). It builds one in-memory database per test file, applies `drizzle/`, and empties the tables on each later call. Use `createTestDb({ fresh: true })` only when a test needs two databases at once. No secrets are needed.

## 4. Loading data

Five different things. Do not mix them up.

| Command | What it does |
|---|---|
| `npm run seed:generate -- --store solenne\|tidepool\|all --as-of 2026-10-31` | Writes `dataset.json`, `truth.json`, `plan.csv`, `ad-spend.csv`, `costs.csv` and `cost-assumptions.csv` to `fixtures/<store>/`. Deterministic (seed 42). It overwrites the committed files, which match the loaded stores, so only rerun it to change the data |
| `npm run seed:load -- --store <store> [--dry-run] [--limit N]` **[live]** | Creates the products, customers, orders and refunds in the dev store through the seeder app. About 5 orders a minute, so a full Solenne load takes hours. Resumable: `.seed-journal/<store>.json` (git-ignored) records what is done, so keep it. `--dry-run` makes no network calls. Ask first |
| `npm run seed:topup -- --store solenne\|tidepool\|all [--dry-run] [--through YYYY-MM-DD]` **[live]** | Adds the orders and refunds for the complete store-local days since the first load (as-of 2026-10-31), so Pace has a recent month. It regenerates in memory (the generator is deterministic and refuses to run if it no longer reproduces the first load), writes no fixture, and never touches the catalog or stock. Needs the first load's journal. Loads complete days only: Shopify stamps an order dated in the future with the moment it is created. Safe to rerun, and run it again each day before a demo. `--dry-run` makes no network calls; `--through` (dry run only) previews a later day. Ask first |
| `npm run seed:extra -- --store solenne\|tidepool [--dry-run]` **[live]** | Creates hand-picked demo orders for the store (new and returning customers, tag `demo-extra`): `X_TP_001` to `X_TP_004` on 2026-11-01 and `X_TP_005` on 2026-11-03 for Tidepool, which the generator gave no order on either day, and `X_SOL_001` to `X_SOL_003` on 2026-11-01 for Solenne, whose generated day is thin. Run on 2026-11-02: three orders on each store; `X_TP_004` and `X_TP_005` added on 2026-11-04. Same loader, journal and no-personal-data customers as the seed. Refuses while an order is still dated in the future (Shopify would stamp it with the creation time) and says when to run it. Safe to rerun. Ask first |
| `npm run fixtures:load -- [--store solenne\|tidepool\|both] [--check]` | Loads `plan.csv`, `ad-spend.csv`, `calendar.csv`, `costs.csv`, `cost-assumptions.csv` and `call-notes/*.md` into Postgres for the brand that owns the store. Safe to repeat. `--check` only validates the files |

`fixtures:load` needs the shop to be connected to a brand already (it finds the brand from the `*_SHOP_DOMAIN` variable). It manages only the fixture plan, so a plan uploaded in the app is never overwritten. Pace needs the plan, MER and CAC need ad spend, and Why and landing pages from a campaign need the calendar. A reload restores seeded values only for cells that are missing. A cell a person changed to another amount is never overwritten, so it stays as typed until it is cleared on screen (empty its box on the EBITDA page and click away), and clearing it lets `fixtures:load` bring the seeded value back. The card-fee and fulfilment rates have no clear: once saved on screen they stay until someone types the old rates back.

`npm run reconcile:truth -- --store solenne|tidepool [--journal <file>]` is read-only. It compares the synced data with `truth.json` through the same `queryMetric` the agent uses, writes one section per store to `docs/evals/reconciliation.md`, and exits 1 if a difference has no explanation. Explanations live in `scripts/reconcile/explanations.ts`. Add one when you make an extra order in a store, or it shows up as a difference. Without the seed journal, storyline checks on products and variants are skipped. Last run (2026-10-31): no differences on either store. It compares against the 2026-10-31 dataset, so after a top-up it reports the new orders as differences; that is expected.

## 5. Syncing

A sync reads products, variants, orders (with lines and refunds) and inventory through paged GraphQL queries and upserts them into Postgres. It never deletes rows. Each run is a row in `sync_runs`. A run with no result after 15 minutes counts as dead and no longer blocks a new one.

- **On connect.** The OAuth callback starts the first sync.
- **Resync.** The Resync button on `/connect` (`gc_admin` and `gc_partner`) posts to `/api/sync`. The work runs after the response, and the page refreshes every 10 seconds while it runs.
- **Daily cron.** `/api/cron/refresh` runs at 07:00 UTC (`vercel.json`) and syncs every connected store in turn. One failing store does not stop the rest. It needs `Authorization: Bearer <CRON_SECRET>`. With no `CRON_SECRET` set it answers 500, with a wrong one 401. Vercel runs crons on production deployments only. To run it by hand: `curl -H "Authorization: Bearer $CRON_SECRET" <app url>/api/cron/refresh`.
- **`orders/create` webhook.** Shopify posts to `/api/webhooks/shopify`. The route checks the HMAC on the raw body (`SHOPIFY_API_SECRET`), takes the shop from the `X-Shopify-Shop-Domain` header, drops duplicates (`webhook_events`), re-fetches the order by id and upserts it. A failure answers 500 and Shopify retries. The same route handles `app/uninstalled` (clears the token, marks the shop disconnected) and records the three compliance topics. The subscriptions are live only after `shopify app deploy`.
- **Probe.** `npm run sync:probe -- --store <store> [--pages N]` runs the sync's own queries against the real store with the stored token and prints counts, query cost and timings. It is read-only. Use it before a deploy that changes a sync query.

Shopify shows an app only orders created in the last 60 days unless it holds `read_all_orders`. Seeded orders carry the import time as `createdAt`, so the first load stops being readable around 2026-12-30. Rows already synced stay, because sync is upsert only. A store connected after that date would sync no history.

## 6. Connecting a store and updating permissions

Only a `gc_admin` can connect. On `/connect`, enter the `.myshopify.com` address and press Connect store. The app sends the admin through Shopify's consent screen, stores the encrypted offline token with the granted scopes, the time zone and the currency, then starts the first sync.

- The app asks for the scopes in `shopify.app.toml` (also `REQUESTED_SCOPES` in `lib/shopify/connect.ts`). Only the five read scopes are required to connect. A store without a write scope still connects. The write that needs it fails later with Shopify's own message.
- Shopify lists only `write_x` when both `read_x` and `write_x` are granted, because write includes read. The code counts a granted `write_x` as `read_x`, so this no longer causes `missing_scopes`.
- **Update permissions** (a button shown to a `gc_admin` on a connected store) runs the same install flow for the same shop. Use it after `shopify app deploy` releases a version with new scopes. Shopify shows only what is new, the store stays connected, and a sync starts again.
- One store per brand, and a store never moves to another brand (`shop_taken`, `tenant_has_shop`). After an uninstall the page shows Disconnected. Press Reconnect store.

## 7. Adding a brand, and roles

A signed-in user's brand comes from the Clerk session. Signing in never creates a brand. To add one:

1. In Clerk, create an organization and add members with one of the role keys below.
2. `npm run tenant:create -- --org <clerkOrgId> [--name <name>]`. Without `--name` it looks the name up with `CLERK_SECRET_KEY`. Running it again for the same org changes nothing.
3. Sign in with that org active. A `gc_admin` connects the store (section 6).

The Clerk instance is invite-only, and users can't create organizations. The built-in `org:admin` and `org:member` roles give no access.

| Role (Clerk key) | Can do |
|---|---|
| `gc_admin` (`org:gc_admin`) | Everything below, plus connect, reconnect and update permissions |
| `gc_partner` (`org:gc_partner`) | Chat, Pace, Resync, upload and confirm plans, propose and approve actions, approve briefs, open the portfolio, confirm notes |
| `client_viewer` (`org:client_viewer`) | Chat and Pace for their own brand, read confirmed notes, read approved briefs. No calendar or call notes, no writes, no portfolio, no plan |

Reviewer demo logins: `reviewer-gc+clerk_test@example.com` is `gc_partner` in both brands, and `reviewer-client+clerk_test@example.com` is `client_viewer` in Solenne.

## 8. The agent and models

`lib/agent/models.ts` is the registry of models the server will use. The chat picker sends an app id (`claude-sonnet-4-6`, `kimi-k3`, `minimax-m2-5`, `devstral-2`, and so on), never a Bedrock id. Anything not in the registry is refused with `INVALID_INPUT`.

- With `BEDROCK_CLAUDE_ENABLED` unset, the models are Claude Sonnet 4.6 (`eu.anthropic.claude-sonnet-4-6`, the default for every role), Kimi K3 (`global.moonshotai.kimi-k3`, slow), MiniMax M2.5 (`minimax.minimax-m2.5`) and Devstral 2 (`mistral.devstral-2-123b`). All run in eu-central-1 with the app's own Bedrock key. Setting the flag adds the Claude 5.5 models and makes them the defaults.
- With `BEDROCK_CLAUDE_ENABLED=true` (exactly that string), the Claude entries switch on: chat uses Sonnet 5.5, the "why" synthesis uses Opus 5.5, and the summary role uses Haiku 5.5 (nothing calls the summary role yet).
- Turn it on only after AWS has granted Claude access to the account. Until then every Claude call fails with an access error. See [decisions/0000-setup.md](decisions/0000-setup.md). After flipping it, run `npm run eval`.
- Prices in the registry feed only the spend cap, and they are estimates. Claude's reasoning effort is set through `output_config.effort`, which has not been verified on Bedrock.
- **Spend cap.** `TENANT_DAILY_BUDGET_USD` is the cap per brand per UTC day (default 5, the same for every brand). A missing or invalid value gives the default, never no cap. It counts chat runs only (not eval or brief runs). The chat warns at 80% and answers `BUDGET_EXCEEDED` at 100% until midnight UTC.
- **Loop.** At most 8 steps and a 90-second turn limit. A timeout or 5xx is retried once on the same model, and then once on the fallback model (section 9a). The number checker compares every number in the answer with this turn's tool results, sends one repair turn if any are unmatched, and flags what is still unmatched.
- **Audit.** `agent_runs` (one per turn: model, tokens, cost in millionths of a dollar, status, error code) and `agent_steps` (one per tool call, with the model's own arguments). Prompts, answers and tool results are not stored. Provider error text goes to the server log only.
- `npm run chat:try -- --store solenne|tidepool --q "<question>" [--model <id>]` **[paid]** asks the real agent one question against the synced data and prints the answer, tool steps, number check and cost.

## 9. Evals

`npm run eval -- [--case <id>]... [--model <id>] [--out <file>]` **[paid]** needs `AWS_BEARER_TOKEN_BEDROCK` in `.env.local`. It asks the real model each case against the fixture data in an in-memory database (not the live one), with the clock pinned per case. Graders are deterministic, and expected numbers come from the dataset and fixture files, not from `lib/metrics`. It exits 1 if a case fails.

- The cases are in `evals/cases.ts` and the files it imports (41 today; [evals/notes.md](evals/notes.md) says what they are).
- It writes `docs/evals/latest.md` and `latest.json` only when every case was run (no `--case`). The committed files are from the full 41-case run on Sonnet 4.6 on 2026-11-03 (35 of 41; [evals/notes.md](evals/notes.md) says which failed and why). A case that needed the repair turn (the number check sent its first answer back once) shows ", repaired" on the run's line, and `latest.md` says the answer shown is the second. `--out` writes the run's JSON to a path you choose.
- `AGENT_SINGLE_AGENT=true` leaves out `explain_gap`, to compare one agent with the multi-agent "why". It is for evals only.
- Run it when you change `lib/agent`, `lib/tools`, prompts or `models.ts`. It is run locally and the result is committed: there is no eval run in CI (section 9a). `--max-cost <usd>` (or `EVAL_MAX_COST_USD`) stops starting new cases once the estimated cost reaches the cap. A full run also writes `docs/evals/scoreboard.md` and `.json`.
- `docs/evals/reconciliation.md` comes from `reconcile:truth` (section 4), not from this.

## 9a. Ops: tracing, model fallback and evals in CI

**Model fallback.** If the chat model times out, returns a 5xx, throttles or is unavailable before any answer text has streamed, the turn moves once to a fallback model and carries on from the tool steps that had finished (their tools are not run again). It never retries after text has started streaming, never after a budget, validation or tool error, and never twice. `AGENT_FALLBACK_MODEL_ID` names the fallback (a key in `lib/agent/models.ts`). Unset, it is Devstral 2, or Opus 5.5 once `BEDROCK_CLAUDE_ENABLED=true`. The run's `agent_runs.model_id` holds the model that answered, an `agent_steps` row with the tool name `model_fallback` records the from, to and reason (for example `http_503`), and the spend of both attempts is on the run, so it counts against the brand's daily cap. The decision is `lib/agent/fallback.ts`.

**Langfuse tracing.** Off unless all three of `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` are set (no errors and no network without them). To turn it on:

1. Create a project at cloud.langfuse.com (or your own Langfuse) and an API key pair under Settings, API keys.
2. Put the three variables in `.env.local` and in the Vercel project's environment variables (`LANGFUSE_BASE_URL` is the host, for example `https://cloud.langfuse.com`). Redeploy.
3. Open a chat and look for the trace. It is named `oasis-pace.chat`, tagged `tenant:<id>`, `route:<chat|brief|audit|eval>` and `model:<id>`, with the tenant id as the Langfuse user and the tool names in the metadata. The `execute_tool` spans name the tools that ran.

Prompts, answers and tool arguments or results are never recorded (`recordInputs` and `recordOutputs` are off on every call). The chat route flushes in `after()`, and `npm run eval` flushes before it exits. The code is `lib/ops/tracing.ts`, started from `instrumentation.ts`.

**Evals in CI (not enabled).** On 2026-11-02 Asim chose to run evals locally and commit the scoreboard instead of running them in CI. `.github/workflows/evals.yml` is kept and starts only on demand (Actions, Evals, Run workflow); it has no pull request trigger, and no secrets are set in GitHub, so starting it today fails at the first model call. To enable it, add these in GitHub, Settings, Secrets and variables, Actions:

- Secret `AWS_BEARER_TOKEN_BEDROCK` (the Bedrock API key the app uses), or the pair `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` (an IAM user allowed to invoke the models). Secret `AWS_REGION` (for example `eu-central-1`).
- Optional secrets `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, to trace the runs.
- Optional variables `EVAL_MAX_COST_USD` (the cap per run in US dollars, default 3, which a full 41-case run at $6.29 exceeds, so set it higher for one) and `BEDROCK_CLAUDE_ENABLED`.

A run stops starting new cases once the estimated cost reaches the cap and says so (`npm run eval -- --max-cost 8`, or `EVAL_MAX_COST_USD`); with the cap hit, `latest.*` is not written. The scoreboard (accuracy, cost, average and p95 latency per category and overall) goes to `docs/evals/scoreboard.md` and `.json` with `latest.md` and `latest.json`. To keep a result, commit those four files. The 41-case full run cost $6.29 on Sonnet 4.6 (2026-11-03), so run it with `--max-cost 8`.

## 10. Approved writes

The agent can ask for a change. It cannot make one.

1. A `gc_admin` or `gc_partner` asks in chat. The model calls `propose_action` with typed fields. The kinds are `metric_target` (Shopify Metric Target for net sales or orders), `annotation` (a chart annotation) and `discount_deactivate` (turn a discount code off; the code stays in the store). A landing page is the fourth kind (section 11). `segment_create` creates a customer segment from one of the four fixed segments (champions, at risk, due to reorder, one and done); it needs the `write_customers` scope (released 2026-11-02; each store accepts it with Update permissions), and on a store that has not accepted it approving fails safely with a plain message. It has run live once: an approved card created a segment that shows in Shopify. At most three proposals per turn.
2. The server validates the payload, builds the GraphQL itself (user text only goes in variables), stores the payload with its hash in the `actions` table, and shows an approval card in chat and on `/actions`.
3. A `gc_admin` or `gc_partner` approves or rejects (`/api/actions/<id>`). Approval re-checks the payload against its hash, then moves proposed to approved to running in one conditional update, so a double click runs once. The result is `done` or `failed`, or `rejected`.
4. The ledger keeps who decided, when, the payload, and the result or error. A `client_viewer` can neither propose nor decide.

**Reviewer dry runs.** If the approver's Clerk user id is in `REVIEWER_USER_IDS`, the approval is recorded as a dry run: the card shows the exact mutations, the action is marked `done` with `dryRun` set, and Shopify is never called. With the variable empty, nobody is a reviewer. The same applies to brief approvals (section 13). Since 2026-11-05 production leaves it empty: Asim wants the reviewer logins to write for real.

Writes need their scopes: `write_reports` (target), `write_analytics_annotations`, `write_discounts` (with `read_discounts` for the code lookup), `write_customers` (for `segment_create`; in the toml and requested at install, and a store has it once it accepts Update permissions after `shopify app deploy`). Shopify refuses a second target for the same metric and dates, and limits annotations per app per shop. The Oasis plan is not changed by a Metric Target.

## 11. Landing pages

`draft_landing_page` (GC roles) takes a campaign from the calendar or a product.

- **The model writes words only:** a headline, subhead, 2 to 5 bullets, a button label and 1 to 6 product handles. No Liquid, HTML, links, prices or numbers (a number is allowed only if the campaign row holds it).
- **The server does the rest:** it builds `sections/oasis-landing-<slug>.liquid` and `templates/page.oasis-landing-<slug>.json` from fixed templates, with the copy escaped. Prices and stock are Liquid objects (`| money`), read live. Its own lint rejects a typed price, an unknown product handle, scripts, external links and unneeded Liquid tags. Then Shopify's Theme Check runs on the files. A failed draft goes back to the model with the reasons. After a few failures in one answer it stops.
- **On approval** the app finds the unpublished theme (the first named like "Copy of ...", else the first unpublished one; never the live theme), writes both files with `themeFilesUpsert`, and creates a hidden page `/pages/oasis-<slug>` that uses the template. A person publishes in the Shopify admin.
- **The unpublished copy.** Each store needs one: in Shopify admin, Online Store, Themes, duplicate the live theme. With none, approval fails with a message that says so.
- **The exemption.** Shopify allows `themeFilesUpsert` only for apps with an exemption, on top of the `write_themes` scope. This app does not have one. Without it Shopify refuses the write, nothing is written and no page is created; the ledger marks the action failed, and the card says it was approved but not written, with the reason. To finish it, run `npm run landing:push -- <action id>` as a signed-in Shopify CLI user: it checks the approved payload against its hash, pushes the two files to the unpublished theme with `shopify theme push --only`, creates the hidden page through the app's connection, and marks the action done. A page already at that address that uses the same template counts as created (so a re-run after a half-finished try can still mark the action done); one with another template is left alone and the refusal stands. It never touches the live theme and publishes nothing, so do not re-run it once the theme it targeted has been published: it would push to the live theme.
- To check a store: `npx tsx scripts/spikes/theme-write.ts --store solenne|tidepool [--write]`. Without `--write` it only reads the granted scopes and themes. With `--write` **[live]** it upserts one harmless snippet into an unpublished theme.

## 12. Plan upload (`/plan`)

GC roles only. Upload a SOW (PDF) or a plan sheet (CSV), up to 4 MB. The file type is checked from its bytes. Only the text is kept, not the file. A PDF can have at most 40 pages and 150,000 characters of text, and a scan with no text is refused.

- A SOW is read in two model calls **[paid]**. Pass 1 lists each target with a verbatim quote and page, and drops any quote not found on that page. Pass 2 builds structured targets from those sentences. Targets a monthly plan can't hold (refund rate, a quarter total) are listed as not applied.
- The review screen shows each target against the active plan. Confirm makes them the brand's active plan, which Pace and the agent use. Discard drops them. A decision is final. If reading failed, the upload stays and "read again" retries it.
- `npx tsx scripts/plan-in-try.ts` **[paid]** reads the fixture SOW with the real model (two calls, no database) and prints the targets next to the expected ones.

## 13. The Monday brief

`/api/cron/brief` runs weekly, Monday 06:00 UTC (`vercel.json`), with the same `CRON_SECRET` check as the refresh. For each brand with a connected store, it asks the agent loop for a brief **[paid]** (the number checker runs on it) and stores it. The reply is counts: drafted, blocked, skipped (a brief for that week exists) and failed.

- A brief the checker could not fully match, even after its repair turn, is stored as `blocked` and cannot be approved.
- A `gc_admin` or `gc_partner` approves a draft on `/briefs`. Approval hands it to `lib/briefs/deliver.ts`.
- **Delivery is a log line.** Slack is not added yet. Approval writes `[brief] delivered` (brand, week, brief id; never the body) to the server log and marks the brief delivered. A reviewer's approval writes `[brief] dry run` and leaves it undelivered. Slack goes in `deliver.ts`, after the approval check, and nowhere else.
- To run it by hand: `curl -H "Authorization: Bearer $CRON_SECRET" <app url>/api/cron/brief`. It makes one model run per connected brand.

## 13a. Playbooks

`/playbooks` (Growth Capital roles only) runs a saved review with one click. Each playbook is one fixed question that the server writes (`lib/playbooks/questions.ts`) and sends through the shared agent loop, so the number checker runs on the write-up. A request (`POST /api/playbooks`) names only the playbook and, for the monthly review, a month. Nothing else reaches the question.

- **[paid]** Every run is one model call. A brand can run each playbook once per 10 minutes: a second run inside that window answers 429, and a double click is caught too. A run that fails (a timeout or a model error) stores nothing, so it can be tried again at once. A blocked run is stored, so it starts the 10-minute window too.
- A run is stored per brand in `playbook_runs` (migration 0008). It is `ready`, or `blocked` when the checker could not match every figure after its one repair turn. A blocked run lists the unmatched figures and says to treat the write-up as unchecked. A write-up is stored whole up to 8,000 characters (`MAX_BODY_CHARS` in `lib/playbooks/generate.ts`, raised from 4,000 for Creative briefs), and a longer one is cut at 8,000 without a word and is still shown as Ready. The page leaves out a paragraph that is only a horizontal rule, and shows each playbook's latest run and up to five earlier ones.
- Playbook runs are not counted by the daily spend cap (section 8 counts chat runs only), so the 10-minute limit is the only limit on how often one runs.
- **How a run is drawn.** A finished Black Friday review, Retention check or Monthly business review is drawn as a short report: the period on top, a numbered card per paragraph with its bold lead-in as the heading, money and percentages highlighted, and the closing "what to watch" paragraph as a note. A blocked run, or a write-up that does not split into at least two paragraphs with lead-ins, is shown as plain text, so no word is lost either way.
- **Live numbers.** Above the latest run of each playbook, two views of the figures the write-up is about are drawn from the synced store data when the page opens, with the same components as a chat answer: the Black Friday review shows the weekend's figures and orders by discount code; the Retention check, the returning-customer rate and (folded) the cohort grid; the Monthly review, the month's figures against plan and (folded) net sales by day; Creative briefs, the best sellers and (folded) last year's Black Friday weekend. Each is for the period the write-up covers and carries its dates, its as-of time and its query id. They cost no model call. A figure can differ slightly from the write-up if orders arrived after the run (the retention check's last day, for one). A view that cannot be drawn (a period with no synced data) says so and leaves the others.
- The playbooks are code, so adding one needs a deploy and no migration (`playbook_runs.playbook` is plain text).

| Playbook | What it does | Cost of a run |
|---|---|---|
| Black Friday review (`bfcm-review`) **[paid]** | How the last Black Friday to Cyber Monday weekend went, which discount codes drove it, and which variants are most at risk of running out before the next one | about $0.12 to $0.14 |
| Retention check (`retention-check`) **[paid]** | The repeat rate by first-order month, and how the share of returning customers moved against the previous 30 days | about $0.12 to $0.14 |
| Monthly business review (`monthly-review`) **[paid]** | A finished month against plan: the main numbers, what drove the gap, and the cause with its source. Takes a month (YYYY-MM); without one it reviews the last month | about $0.12 to $0.14 |
| Creative briefs (`creative-briefs`) **[paid]** | Three creative briefs for the brand's next campaign, from its own numbers: best customers first, win back the quiet ones, new customers. Takes no input. Eight read-tool calls in two steps (first the calendar for the next 60 days, the customer segments, the top eight products by units over the last 90 complete days, the post-mortem of the latest Black Friday weekend whose 180-day repeat window has finished, and the EBITDA what-if at a 10% and a 25% price cut, quoted only as a profit margin and never in dollars; then those products' margin and stock). The write-up is asked to be under 480 words, and it starts with a campaign line, a "Last year" paragraph and a "Not pushing" line. The page draws a finished run as three brief cards (the campaign line and the Last year and Not pushing notes above them; each card shows who, the angle, the hook lines with a Copy button on each and the Do not line, and folds the product, offer, proof and measure under a closed Details row); a blocked run, or a write-up whose layout cannot be read, stays plain text. Under a finished run, a link opens Chat, which asks for the campaign's landing page at once (a paid chat run, counted by the daily spend cap), where the landing page draft and approval card (sections 10 and 11) take over | about $0.23 to $0.46 (eight live runs on 2026-11-03) |

The cost for the first three is the figure recorded for T18 in [build-plan.md](build-plan.md).

**Creative briefs needs a calendar entry to name a campaign.** It writes for the first promotion, campaign or launch on the marketing calendar that has not started yet, within 60 days of today. The calendar comes from `calendar.csv` through `npm run fixtures:load` (section 4), and the app has no calendar editor. If nothing is planned in that window (no calendar loaded, the campaign is further out, or it has already started or is over), it writes for the next 30 days in general and says nothing is planned. On the demo data both brands have Black Friday and Cyber Monday 2026 (27 to 30 November) on the calendar. That fallback has not been run live.

Its eval case is `creative-briefs-black-friday` (`evals/t23-cases.ts`, 38 checks): `npm run eval -- --case creative-briefs-black-friday` **[paid]**. It has passed three times in eight runs on 2026-11-03: once on an earlier wording of the question (31 of 31 checks) and twice in a row on the final wording (38 of 38, each after one repair turn). Two passes in a row is a tiny sample, so a run can still be Blocked, and a retry costs about $0.34. The checker is lenient for small whole numbers, so "verified" in a case is a floor and not proof.

## 14. Deploying

Vercel builds and deploys every push to `main` (project `oasis-pace`). Environment variables are set in the Vercel project, and a change takes effect on the next deploy. The app needs everything in section 1 except the `SEEDER_*` and `*_SHOP_DOMAIN` variables.

1. `npm run typecheck`, `npm run lint`, `npm test`.
2. If the schema changed: `npm run db:migrate`.
3. Push to `main`. Do not run `vercel --prod` without the owner's go-ahead.
4. If `shopify.app.toml` changed (scopes, webhooks, URLs), the owner runs `shopify app deploy --allow-updates`. It needs a browser login and releases a new app version. `[webhooks] api_version` in the toml must equal `lib/shopify/version.ts` (a test checks it).
5. After new scopes, a `gc_admin` presses Update permissions in each store (section 6).
6. Check both reviewer logins from a fresh browser.

## 15. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `/connect?error=missing_scopes` | A required read scope was not granted. Press Reconnect store and accept every permission |
| A write fails with an "access denied" or scope message | The store lacks a write scope. Release the scope with `shopify app deploy`, then press Update permissions and accept it |
| `STORE_DISCONNECTED` ("The store needs reconnecting") | The app was uninstalled or the token cleared. A `gc_admin` presses Reconnect store on `/connect` |
| "This brand isn't set up yet" (`no_tenant`) | The Clerk org has no tenant. Run `npm run tenant:create` (section 7) |
| `BUDGET_EXCEEDED` | The brand hit `TENANT_DAILY_BUDGET_USD` for the UTC day. It resets at midnight UTC. To raise the cap, change the variable in Vercel and redeploy. Spend is the sum of `cost_micros` in `agent_runs` where `source = 'chat'` since 00:00 UTC |
| Answers look old, or `DATA_STALE` | The code defines `DATA_STALE` and has banner text for it, but nothing raises it yet. Check "Data as of" and the last run on `/connect`, press Resync, and check the Vercel cron log. A store whose newest order is over 36 hours old uses the demo clock, so "today" is the day after that order |
| "A sync is already running" | A run is open. It is treated as dead after 15 minutes. A failed run shows its error on `/connect` |
| A sync fails with "Access denied ... Required access" | A query asks for a field behind a scope the app lacks. Run `npm run sync:probe` to see it, and remove the field or add the scope |
| Cron route answers 401 or 500 | `CRON_SECRET` is wrong or not set in Vercel |
| Webhook answers 401 | The HMAC failed. Check `SHOPIFY_API_SECRET` in Vercel. If new orders never arrive and nothing is logged, `shopify app deploy` may not have released the `orders/create` subscription yet |
| Theme Check fails or times out | Theme Check runs inside the chat function on bundled docs (`next.config.ts` includes them) and may try one network fetch. If it can't finish in 30 seconds the draft fails with "Theme Check did not finish in time". This has not been verified on the deployed route. Check Vercel Logs. The bundled docs are included through `outputFileTracingIncludes` in `next.config.ts` |
| Creative briefs says it couldn't run, and no run is stored | The loop has 8 steps and Creative briefs names 8 tool calls, so its question asks for six in one step and two in the next. If the model made them one at a time, no step would be left to write and the run would fail with "could not be written up". This has not happened in eight live runs. Try again at once (a failed run starts no 10-minute wait). If it keeps failing, cut the second what-if (the 25% price cut) from `creativeBriefs` in `lib/playbooks/questions.ts`: seven calls fit the loop even one at a time. A timeout (the route allows 120 seconds; the live runs took 27 to 55 seconds) or a model error looks the same, so check Vercel Logs |
| Creative briefs says the calendar has nothing planned | No promotion or campaign is on the marketing calendar in the next 60 days. Load `calendar.csv` with `npm run fixtures:load` (section 4) and check its dates. The 30-day write-up is the designed fallback, not a failure |
| `INTERNAL_ERROR` in chat | Provider and unexpected errors are shown as this. The detail is in Vercel Logs, and failed tool calls are in `agent_steps` |
| Every Claude call fails with an access error | `BEDROCK_CLAUDE_ENABLED=true` was set before AWS granted access. Unset it to go back to Sonnet 4.6 |
| `reconcile:truth` shows a difference | An extra order or a changed fixture. Add a note in `scripts/reconcile/explanations.ts`, or find the real cause |
