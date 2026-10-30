# Oasis Pace Implementation Plan

> **For agentic workers:** Work through the tickets in the order given under File Structure, using superpowers:subagent-driven-development or superpowers:executing-plans. Where a skill disagrees with `CLAUDE.md`, `CLAUDE.md` wins: never stage, commit or push, and stop at each checkpoint, even if a skill says to commit, use a worktree or carry on without pausing. Steps use checkboxes (`- [ ]`). At each checkpoint, stop, list the changed files and suggest a commit message for Asim.

**Goal:** A standalone Shopify app, built as an Oasis module, where GC staff and client viewers ask an AI agent about store data and get numbers they can verify. The stretch is a plan-to-pace loop.

**Architecture:**
- Next.js on Vercel with Clerk tenancy, one Clerk organization per client brand.
- Shopify OAuth connects a dev store. A bulk export fills Postgres on connect, on Resync and nightly, and an `orders/create` webhook adds new orders as they happen.
- A typed metric layer is the only source of numbers. A Claude agent calls typed tools, and a number checker verifies every figure it states.

**Tech stack:**
- Next.js (App Router, TypeScript strict), Tailwind + shadcn/ui, Recharts
- Clerk; Neon Postgres + Drizzle; PGlite for tests
- `@shopify/shopify-api`, Shopify CLI
- Vercel AI SDK + Amazon Bedrock provider (`@ai-sdk/amazon-bedrock`); Zod
- Vitest; Langfuse; GitHub Actions

**Spec:** [docs/product-plan.md](product-plan.md). Read it alongside this plan. The production version of both plans is in [production/](production/); don't build from it unless Asim asks.

## Global Constraints

- Shopify Admin API version is `2026-10`, set in `lib/shopify/version.ts` and in `shopify.app.toml` under `[webhooks] api_version`. A unit test checks they match.
- Node.js 22 or later. TypeScript `strict: true`. No `any` in tool input or output schemas.
- Claude runs on Amazon Bedrock. Model IDs live only in `lib/agent/models.ts`, as the Bedrock IDs noted on Day 0 (`anthropic.`-prefixed, or the region's inference-profile ID):
  - chat: Claude Sonnet 5.5
  - analysis: Claude Opus 5.5
  - summaries: Claude Haiku 5.5
- **Solenne:** timezone `America/New_York`, currency `USD`, data from `2025-09-01` to the seed date.
- **Tidepool Baby:** timezone `America/Los_Angeles`, currency `USD`, data from `2025-11-01` to the seed date.
- Generator RNG seed is `42`.
- **Store dates.** `lib/clock.ts` gives each store's "today" in its timezone. Tool defaults, named periods and the date given to the model all use it. If the store's newest order is more than 36 hours old (a demo store between top-ups), today is that order's date. Tests and evals pin it. Nothing else derives store dates from the system time.
- **Dates on records.** Orders are dated by `processedAt` and refunds by their own `processedAt`, in the store timezone. `createdAt` is never used for metrics. Date ranges include both ends.
- Tool defaults: the date range is the last 30 days; the row cap is 50, maximum 200. A larger limit is reduced to 200 and the result says so.
- Agent step cap is 8 per turn. Model spend cap is $10 per tenant per UTC day, with a warning at 80%. Eval runs don't count against it.
- Never call Shopify from client components. Authorization never comes from tool input or the model: signed-in users get their tenant from `getTenantContext()`, webhooks from the HMAC-verified shop domain, and the nightly job checks `CRON_SECRET` and works on one tenant at a time.
- Role permissions follow the access table in product plan §7. They are enforced where tools are registered and in server actions, not only by hiding UI.
- No customer name, email, phone or address column anywhere in Postgres, and no checked-in GraphQL document asks for those fields. Customers are `CUST_` plus 8 hex characters.
- The 8 error codes are `STORE_DISCONNECTED`, `SHOPIFY_THROTTLED`, `SHOPIFY_UNAVAILABLE`, `DATA_STALE`, `NO_DATA`, `INVALID_INPUT`, `MODEL_TIMEOUT` and `BUDGET_EXCEEDED`. Their UI copy is in product plan §8.
- `DATA_STALE` is a warning, not a failure. It fires when the last successful sync (bulk export or nightly refresh) finished more than 26 hours ago. The answer is still returned, with its age shown.
- Before claiming done: `npm run typecheck && npm run lint && npm test`. At checkpoints that change `lib/agent`, `lib/tools`, prompts or `models.ts`, also `npm run eval`.
- Claude never runs `git add`, `git commit` or `git push`, and asks Asim before `shopify app deploy`, uninstalling an app, `vercel --prod` or `npm run seed:load`.

## Review Focus

| # | Situation | Expected behavior | Test owned by |
|---|---|---|---|
| 1 | Questions at timezone edges: orders at 00:30 and 23:30 local time around a month boundary, and on the DST change days (2025-11-02, 2026-03-08) | Counted on the store-local date | T3 |
| 2 | A period with no data (before 2025-09-01, before Tidepool's 2025-11-01, or after the data ends) | Return `NO_DATA` and say so. A filter with no matching rows inside the data window returns 0 | T3 and T4 |
| 3 | "List every order" | 50 rows, plus "50 of N" and a suggestion to aggregate | T3 and T4 |
| 4 | Store uninstalled or token revoked mid-session | Every tool returns `STORE_DISCONNECTED`, and the UI shows the reconnect action | T1, T3 and T4 |
| 5 | Refund in a later month than its order | `refunds` lands in the refund month and `refund_rate` in the order month; the answer says which | T3 |

## File Structure

```
proxy.ts                                     Clerk middleware; webhook, OAuth and cron routes stay public   T1
app/(auth)/sign-in/[[...sign-in]]/page.tsx   Clerk sign-in
app/(app)/layout.tsx                         org switcher, nav, demo-data banner
app/(app)/connect/page.tsx                   connect store, sync status, Resync   T1/T3
app/(app)/chat/page.tsx                      agent workspace                      T4
app/(app)/pace/page.tsx                      stretch                              T5
app/api/shopify/install|callback/route.ts    OAuth                                T1
app/api/webhooks/shopify/route.ts            verified, idempotent webhooks        T1
app/api/chat/route.ts                        agent streaming endpoint             T4
app/api/cron/refresh/route.ts                nightly refresh                      T3
lib/clock.ts                                 store-local today, demo clock        T1
lib/tenancy/context.ts                       getTenantContext, repo guard         T1
lib/crypto/secrets.ts                        AES-256-GCM token encryption         T1
lib/errors.ts                                AppError + ErrorCode                 T1
lib/shopify/{version,client,oauth,webhooks}.ts                                    T1
lib/db/{schema,client}.ts + drizzle/         schema and migrations                T1/T3
lib/sync/{bulk,map,handlers,refresh}.ts      bulk export, shared mapper, webhooks, nightly refresh   T3
lib/metrics/{registry,query,dimensions}.ts   the metric layer                     T3
lib/tools/*.ts                               tool functions + Zod schemas         T3
lib/agent/{models,prompt,checker,run}.ts     agent loop, number checker           T4
lib/audit/{runs,budget}.ts                   audit log, spend cap                 T4
components/chat/*, components/views/*        chat UI, view components             T4/T5
scripts/seed/{types,generate,truth,load,topup}.ts                                 T2
scripts/spikes/*.ts                          pilot check and day-1 spikes         T2
scripts/fixtures/load-db.ts                  dataset.json → test database         T3
scripts/reconcile-truth.ts                   synced data vs truth.json            T3
scripts/tenant-create.ts                     the only way a tenants row is made   T1
fixtures/{solenne,tidepool}/*                dataset, truth, plan, calendar, notes, SOW, ad spend   T2
evals/{cases/*.yaml,run.ts,graders.ts}       eval harness                         T4
shopify.app.toml, shopify.app.seeder.toml    app configs                          T1/T2
docs/{metrics,runbook}.md, docs/decisions/*.md, docs/evals/                       T2–T4
.github/workflows/ci.yml                     typecheck, lint, test                T1
.gitignore                                   names the two reference PDFs         T1
```

**Order:** Day 0 is manual and comes first. Then T1 and T2 run in parallel, and T2's full seed load starts once its pilot passes. T3 needs both. T4 needs T3. T5 needs T4.

**Time:** core and polish (Day 0 to T4) is about 9–11 working days, including a 15% buffer. Stretch A–D is about 4–6 days. A re-seed costs about 10 hours of wall-clock time.

---

### Day 0: Accounts and Shopify setup (manual, about half a day)

**Deliverable:** every account, app and store exists, both apps are installed on both stores, and `.env.local` is filled in. Asim does these steps; Claude can walk through them.

- [ ] Complete Shopify's developer identity verification. It's required since 2026-10-27 before apps can be installed on dev stores, and it can take time, so start here.
- [ ] In your Dev Dashboard organization, create the Solenne and Tidepool dev stores with test data generation off. Set each store's timezone and currency (Global Constraints).
- [ ] Create the Vercel project, so the app's production URL is known and stable before the first Shopify deploy.
- [ ] In the same organization, create the product app and the seeder app. Select custom distribution for both, and test-install both on both stores before any code is written.
- [ ] For both apps, set protected customer data to Level 1 for orders and customers, with no name, email, phone or address fields. Without it, order and customer queries are denied and order webhooks are rejected.
- [ ] Request `read_all_orders` for the product app (reason: agency reporting over 14 months of order history). Don't declare it in `shopify.app.toml` until it's approved, or `shopify app deploy` fails.
- [ ] Clerk application on a development instance: turn on Organizations, create the roles `gc_admin`, `gc_partner` and `client_viewer`, set sign-up to invite-only, stop users from creating organizations, and create the Solenne and Tidepool orgs.
- [ ] A Neon project and a Langfuse project.
- [ ] AWS: Bedrock access to Claude Sonnet 5.5, Opus 5.5 and Haiku 5.5 in one region (complete Anthropic's first-time-use form if asked), with each model's exact ID noted; an IAM user allowed only to invoke models, with an access key; and an AWS Budgets alert.
- [ ] Fill in `.env.local` with the variables listed in T1's first step. It's never committed.

---

### T1: Platform foundation (about 2 days, needs Day 0)

**Deliverable:** A deployed app where a signed-in user connects a Shopify dev store securely. Webhooks are verified, and the tenant is resolved on the server.

**Interfaces produced**
- `getTenantContext(): Promise<TenantContext>`
  - `TenantContext = { tenantId: string; orgId: string; userId: string; role: 'gc_admin' | 'gc_partner' | 'client_viewer'; shop: { domain: string; timezone: string; currency: string; status: 'connected' | 'disconnected' } | null }`
  - It throws when the active org has no `tenants` row; it never creates one.
- `storeToday(timezone: string, newestOrderAt: string | null): string` in `lib/clock.ts` returns `YYYY-MM-DD` under the rule in Global Constraints. `setTestNow(iso: string)` pins it in tests and evals.
- `class AppError extends Error { code: ErrorCode; retryable: boolean }`
- `shopifyGraphql<T>(conn: ShopConnection, query: string, variables?: Record<string, unknown>): Promise<T>`
  - Retries when throttled, using `extensions.cost.throttleStatus`. A throttle arrives as a `THROTTLED` error in a 200 response, not a 429.
  - Maps 401 to `STORE_DISCONNECTED`, and 5xx after retries to `SHOPIFY_UNAVAILABLE`.
- `encryptSecret(plain: string): EncryptedSecret` and `decryptSecret(s: EncryptedSecret): string`, with `EncryptedSecret = { v: number; iv: string; tag: string; data: string }`
- `onWebhook(topic: string, handler: (ctx: WebhookCtx, payload: unknown) => Promise<void>): void`, with `WebhookCtx = { tenantId: string; shopDomain: string; webhookId: string }`, resolved from the HMAC-verified shop domain.
- Tables:
  - `tenants`
  - `shop_connections (tenant_id, shop_domain, token_enc, refresh_token_enc NULL, expires_at NULL, scopes, status, timezone, currency)`, with unique indexes on `shop_domain` and on `tenant_id` among connected rows
  - `webhook_events (webhook_id UNIQUE, topic, shop_domain, received_at, processed_at NULL, error NULL)`
  - `compliance_requests (id, shop_domain, topic, received_at)`

**Steps**
- [ ] Scaffold Next.js (TS strict), Tailwind, shadcn/ui, ESLint and Vitest. `create-next-app` won't scaffold into a folder that already holds `CLAUDE.md` and the PDFs, so scaffold in a temporary folder and move the files in. Add the scripts `dev`, `build`, `typecheck`, `lint` and `test`.
  - `.gitignore`: keep the generated rules and add `/Growth Capital Developer Takehome.pdf`, `/main-agentic-ai-team-lead.pdf` and `!.env.example`. Never `*.pdf`, because `fixtures/solenne/sow.pdf` is committed.
  - `.env.example` lists every variable: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `TOKEN_ENCRYPTION_KEY`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `CRON_SECRET`, `SEEDER_CLIENT_ID`, `SEEDER_CLIENT_SECRET`, `SOLENNE_SHOP_DOMAIN` and `TIDEPOOL_SHOP_DOMAIN`.
- [ ] Clerk (configured on Day 0):
  - sign-in and Organizations, with the three roles
  - Asim as `gc_admin` in both orgs
  - two reviewer logins with Clerk test-mode emails (`…+clerk_test@example.com`, which accept the code 424242): one `gc_partner` in both orgs, and one `client_viewer` in Solenne
  - `npm run tenant:create -- --org <orgId>` creates a tenant row; nothing else does
- [ ] `proxy.ts` runs `clerkMiddleware()`. The webhook, OAuth callback and cron routes stay public and check their own signatures.
- [ ] Neon + Drizzle schema and migrations for the tables above. Production uses the Neon serverless driver over WebSockets (`drizzle-orm/neon-serverless`), because the HTTP driver has no interactive transactions. Tests use in-memory PGlite (`drizzle-orm/pglite`) with the migrations applied, so CI needs no database secrets.
- [ ] Write failing tests:
  - `secrets.test.ts`: round-trip works; an unknown key version throws.
  - `webhooks.test.ts`: a valid HMAC returns 200; a bad HMAC returns 401; a repeated `X-Shopify-Webhook-Id` that was processed is skipped, and one whose handler failed is processed on the retry; `app/uninstalled` sets the connection to `disconnected` and clears the token; the three compliance topics return 200 and write a `compliance_requests` row.
  - `client.test.ts`, with mocked fetch: a throttled response then success resolves; 401 throws `STORE_DISCONNECTED`; three 503s throw `SHOPIFY_UNAVAILABLE`.
  - `context.test.ts`: a repository call without a tenant throws; an org with no `tenants` row throws.
  - `clock.test.ts`: an order at 23:30 New York time is still that local day; a store whose newest order is 2 days old gets that order's date as today.
  - `version.test.ts`: `lib/shopify/version.ts` and `shopify.app.toml` pin the same API version.
- [ ] Implement the interfaces above until the tests pass.
- [ ] `shopify.app.toml`:
  - `embedded = false`
  - core read scopes from product plan §7, without `read_all_orders` until Shopify approves it
  - `[webhooks] api_version = "2026-10"`
  - webhook subscriptions: `app/uninstalled` and the compliance topics `customers/data_request`, `customers/redact`, `shop/redact`
  - the Vercel production URL as the app URL and in the redirect URLs
- [ ] Link the product app with `shopify app config link` and, after asking Asim, run `shopify app deploy`.
- [ ] OAuth routes using `@shopify/shopify-api`, which checks the state, the HMAC and the shop domain. Only a `gc_admin` can start an install. The callback stores the encrypted token against the current tenant, and rejects a grant that's missing a required scope or a shop already connected to another tenant.
- [ ] `/connect` page with a Connect button and the connection's status.
- [ ] `.github/workflows/ci.yml` running typecheck, lint and test.
- [ ] Deploy to Vercel and set the environment variables.
- [ ] **Verify:** `npm run typecheck && npm run lint && npm test` passes. On the Vercel URL:
  1. Sign in as Asim (`gc_admin`) and connect Solenne and Tidepool, each in its own org. `/connect` shows "Connected" for each.
  2. Uninstall the app from Solenne's admin. Within a minute, `/connect` shows "Disconnected". Reconnect it.
  3. In a fresh incognito window on another device, both reviewer logins sign in with the code 424242.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

### T2: Demo stores and ground truth (about 2–2.5 days plus overnight seeding, runs in parallel with T1)

**Deliverable:**
- both dev stores seeded with deterministic data full of storylines, after a pilot that matched
- `truth.json` for each store
- the agency context fixtures
- the results of the day-1 spikes

**Interfaces produced**
- `scripts/seed/types.ts`:
  - `Dataset = { store; asOf; products: {genId, title, description, collectionGenIds}[]; variants: {genId, productGenId, sku, price, unitCost}[]; customers: {genId, persona}[]; orders: {genId, processedAt, customerGenId, lines: {variantGenId, qty, unitPrice}[], shipping, discountCode?, channel, tags, note?}[]; refunds: {genId, orderGenId, processedAt, lines: {variantGenId, qty}[], reason}[]; discounts; inventory }`
  - `persona` is one of `loyalist`, `regular`, `one_and_done`, `deal_seeker`, `gifter` or `wholesale`. `processedAt` is ISO 8601 with the store's UTC offset.
- `truth.json`:
  - `{ store, seed, asOf, window: {from, to}, monthly: Record<'YYYY-MM', Record<MetricId, number>>, storylines: { id, from, to, entities: string[], finding: string, checks: { metric, filter, period, expected, tolerance }[] }[] }`
  - `monthly` holds the store-level metrics. `repeat_rate` and `zero_sales_days` appear only in storyline checks.
- `fixtures/<store>/`:
  - `dataset.json`, `truth.json`
  - `plan.csv`, `calendar.csv`
  - `call-notes/*.md`
  - `sow.md`, `sow.pdf` (Solenne only)
  - `ad-spend.csv`

**Steps**
- [ ] Link the seeder app (created on Day 0) as `shopify.app.seeder.toml`:
  - scopes: `write_products`, `write_inventory`, `write_locations`, `write_discounts`, `write_customers`, `write_orders`, plus `read_reports` for spike (c)
  - token: the client credentials grant with `SEEDER_CLIENT_ID` and `SEEDER_CLIENT_SECRET`. Tokens last 24 hours, so cache one and request a new one on a 401.
  - always pass `--config` to Shopify CLI commands, because linking a config makes it the default
- [ ] Write failing tests:
  - `generate.test.ts`: the same seed and `--as-of` produce the same dataset hash. With an earlier `--as-of`, every order, refund and customer dated up to it is identical, so top-ups extend history without changing it.
  - Each storyline's checks hold. For example:
    - S4: Barrier Cream refund rate between 2026-06-08 and 06-28 is 15–21%.
    - S6: VIPGLOW25 first-time share is at least 65%.
    - S9: October new-customer orders are 15–25% below plan.
    - Every planted effect except S1 is at least 2.5× the variation of the same window on a run with the storylines turned off.
  - `truth.test.ts`: monthly `net_sales` equals the sum of the parts.
- [ ] Implement `generate.ts`. It is pure and takes `--as-of`; it never reads the system time. It builds the catalog with unit costs, the personas, day-by-day orders with seasonality and shipping charges, storylines S1–S10 and TP1–TP2, refunds, discounts and the final inventory. There are no cancellations, and channels are order tags (product plan §6).
  - History keeps fixed dates.
  - S9's budget cut carries on through `--as-of`.
- [ ] Implement `truth.ts`. It must not import from `lib/metrics`, because it is the independent check. For stretch A it also computes `mer` and `new_customer_cac` from `ad-spend.csv`.
- [ ] Implement `load.ts`:
  - Load order: locations, products and variants with cost and stock, discount codes, customers, orders in `processedAt` order, then refunds.
  - Orders: `orderCreate` with `processedAt`, line prices sent explicitly, `sourceIdentifier = genId`, `test: false`, the channel tag, and `sendReceipt` and `sendFulfillmentReceipt` set to false.
  - Refunds: `refundCreate` with `processedAt` from the dataset, `notify: false`, and `@idempotent(key:)` derived from the refund's `genId`.
  - Stock: `inventorySetQuantities` with `changeFromQuantity: null` and an `@idempotent` key.
  - The journal marks each record in flight before its call and done after it. On restart, an order still in flight is looked up with `orders(query: "source_identifier:<genId>")` before it's created again.
  - `userErrors` in a 200 response are failures and are never journaled as done.
  - A limiter holds orders to 5 per minute with backoff. Add `--dry-run`, and `--limit` for the pilot.
  - Tests, with mocked Shopify: a rerun skips done orders; an in-flight order that's already in Shopify isn't created again; a `userError` isn't journaled as done; the limiter test uses fake timers.
- [ ] **Pilot.** After asking Asim, load Solenne's first 50 orders and their refunds (`npm run seed:load -- --store solenne --limit 50`). `scripts/spikes/pilot-check.ts` reads them back through the Admin API and compares each order's and refund's `processedAt`, line prices and discount with the dataset. The full load continues from the pilot.
- [ ] Spikes in `scripts/spikes/`, run on the pilot data:
  - (a) Can orders backdated more than 60 days be read with `read_orders` alone?
  - (b) Has `read_all_orders` been approved yet? Record the date.
  - (c) Using the seeder token with `read_reports`, do ShopifyQL totals for the pilot's days, refunds included, match the dataset?
  - Write the outcomes to `docs/decisions/0001-day1-spikes.md`.
- [ ] **Full load.** Once the pilot matches, and after asking Asim, start `npm run seed:load -- --store solenne`, which runs overnight. Run Tidepool after it.
- [ ] Write the fixtures. Each document starts with the FICTIONAL SAMPLE line from product plan §6.
  - `plan.csv`: the generator's expected values with the storylines turned off, excluding wholesale, from each store's first data month to Dec 2026, with columns named by metric ID
  - `calendar.csv`, containing planned events only
  - 4 call notes
  - `sow.md`, rendered to `sow.pdf`
  - `ad-spend.csv`, including the Meta cut from 2026-10-05
- [ ] `topup.ts` generates with `--as-of` set to now, and loads only the orders and refunds dated up to now. Fixtures and evals stay pinned to the original seed.
- [ ] **Verify:**
  1. `npm run seed:generate -- --as-of <date>` run twice gives identical output.
  2. The pilot check passed, and Solenne's order count in the Shopify admin equals the dataset's count.
  3. The spike decision document exists.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

### T3: Sync and metric layer (about 2 days, needs T1 and T2)

**Deliverable:** Store data synced into Postgres and checked against `truth.json`. Every metric is computed by one registry, tested against `truth.json`. The tool functions are ready for the agent.

**Interfaces produced**
- `syncStore(conn: ShopConnection): Promise<SyncRun>` starts a bulk export and records a `sync_runs` row. `/connect` and the nightly job poll `bulkOperation(id:)`; when it finishes, the JSONL is streamed and upserted.
- `lib/sync/map.ts` turns GraphQL nodes into rows (`mapOrder`, `mapProduct` and the rest). The bulk import and the `orders/create` handler both use it: the handler re-fetches the order by ID through GraphQL rather than reading the webhook's REST-shaped payload.
- `type MetricId`: the 14 IDs in product plan §8.
- `type Dimension = 'day' | 'week' | 'month' | 'product' | 'variant' | 'collection' | 'channel' | 'discount_code' | 'customer_type' | 'tag'`
- `type Period = 'last_7_days' | 'last_30_days' | 'this_month' | 'last_month' | 'this_year'`
- `queryMetric(ctx: TenantContext, input: QueryMetricInput): Promise<ToolResult<MetricRow[]>>`
  - `QueryMetricInput = { metrics: MetricId[]; period?: Period; from?: string; to?: string; groupBy?: Dimension[]; filters?: { productIds?: string[]; discountCodes?: string[]; channels?: string[]; customerType?: 'new' | 'returning'; excludeTags?: string[] }; compareTo?: 'previous_period' | 'previous_year'; cohort?: { firstOrderFrom: string; firstOrderTo: string; firstOrderDiscountCodes?: string[]; windowDays: 30 | 60 | 180 }; limit?: number }`
  - `period` is resolved with the clock. `from` and `to` are inclusive store-local dates that override it. With neither, the range is the last 30 days. `cohort` is required for `repeat_rate`.
  - `MetricRow` carries each value and, when comparing or grouping, `previous`, `change`, `pctChange` and `share`, so the model never computes them.
- `ToolResult<T> = { data: T; queryId: string; range: { from: string; to: string }; definitions: Partial<Record<MetricId, string>>; asOf: string; truncated?: { shown: number; total: number } }`
- The remaining tools, each returning `ToolResult`, with a Zod schema exported next to the function:
  - `getOrders(ctx, input)`
  - `searchProducts(ctx, input)`
  - `getInventory(ctx, input)`
  - `getCustomers(ctx, input)`
  - `describeMetrics(ctx, input)`
- Store text (order notes, product descriptions, titles) comes back as JSON strings under an `untrusted` key, and tools never splice it into instructions. `getOrders` returns a note only for a single order, when the input sets `includeNote: true`.

**Steps**
- [ ] Drizzle tables. Every synced table has `tenant_id NOT NULL`, first in every unique key and index.
  - `products`, `variants`
  - `inventory_levels`, `inventory_snapshots`
  - `customers` (pseudonymous ID = hash of tenant and Shopify ID; no personal columns)
  - `orders`, `order_lines`, `refunds`, `refund_lines`
  - `discount_codes`, `sync_runs`
- [ ] `scripts/fixtures/load-db.ts` loads `fixtures/*/dataset.json` into the test database as two tenants.
- [ ] Write failing tests against that database (PGlite):
  - Every metric's monthly value equals `truth.json` exactly (counts exact, money to the cent, rates to 4 decimal places), for both stores.
  - Review Focus 1: orders at 00:30 and 23:30 local time on 2026-06-30 and 2026-07-01, and on 2025-11-02 and 2026-03-08, count on their local dates.
  - Review Focus 5: a refund in a later month lands in the refund month for `refunds` and in the order month for `refund_rate`.
  - Review Focus 2: `NO_DATA` for 2025-01, for Tidepool before 2025-11-01, and after the data ends. Fig's units for 2026-07-19 → 08-04 are 0, not `NO_DATA`.
  - Review Focus 3: `getOrders` over the full window returns 50 rows with `truncated.total` equal to the order count.
  - Review Focus 4: every tool throws `STORE_DISCONNECTED` when the connection is disconnected.
  - `isolation.test.ts`: every tool called with Tidepool's context returns no Solenne rows, including when it's given Solenne order IDs, `CUST_` IDs and discount codes.
  - `tools.input.test.ts`: an unknown metric or dimension, a malformed date, `from` after `to` and unknown keys give `INVALID_INPUT`; a limit of 500 returns 200 rows with `truncated` set.
  - A schema test that no table has a name, email, phone or address column, and a scan of the GraphQL documents in `lib/shopify` for those fields.
  - A recorded bulk JSONL line and the same order fetched by ID map to the same row, dated by `processedAt` even when `createdAt` differs.
  - A duplicate `orders/create` delivery is a no-op.
- [ ] Implement the metric registry, query builder and tools until the tests pass. `describeMetrics` and `docs/metrics.md` are generated from the registry, including each difference from Shopify Analytics.
- [ ] Implement the bulk export, which runs on connect and from a Resync button. Add `orders/create` to `shopify.app.toml` and, after asking Asim, run `shopify app deploy`. Implement its handler.
- [ ] Nightly refresh at `app/api/cron/refresh`, run by Vercel Cron. It checks `CRON_SECRET`, reruns the bulk export for each connected store, and writes the daily inventory snapshot. That's fine at demo scale; the production plan replaces it with an incremental sync.
- [ ] `/connect` shows synced counts and "data as of …".
- [ ] `npm run reconcile:truth -- --store <store>` computes every month and metric from the synced Postgres through `lib/metrics` and compares it with `truth.json`. It writes any differences, each with an explanation, to `docs/evals/reconciliation.md`.
- [ ] **Verify:**
  1. `npm test` passes, including the metric-vs-truth suite.
  2. On the Vercel URL, the synced counts match the Shopify admin.
  3. `reconcile:truth` shows no unexplained differences for either store.
  4. An order created in Solenne's admin appears on `/connect` within a minute.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

---

### T4: Agent workspace, quality and first submission (about 3 days, needs T3)

**Deliverable:** Core plus polish, complete: the chat agent, UI states, number checker, audit log and spend cap, evals with their results in the README, and the first Loom.

**Interfaces produced**
- `ledgerFromToolResults(results: ToolResult<unknown>[]): ClaimLedger`. Each value carries its unit (money, count or rate) and its `queryId`, from the metric registry.
- `checkClaims(answer: string, ledger: ClaimLedger, toolInputs: unknown[]): { ok: boolean; matched: { span: [number, number]; value: number; queryId: string }[]; unmatched: { text: string; value: number }[] }`
  - A number matches when it equals a ledger value with the same unit, after rounding that value to the precision shown. No sums or ratios are derived.
  - Skipped: dates and times, years, codes and IDs (WELCOME10, `CUST_…`, `#1042`), ordinals, and numbers that appear in the tool inputs (30 days, top 5).
- `runAgent(ctx: TenantContext, input: AgentInput): AgentStream` in `lib/agent/run.ts` is the one agent loop, used by chat and evals. It runs the checker and the repair turn.
- `assertBudget(ctx: TenantContext): Promise<void>` throws `BUDGET_EXCEEDED`.
- `recordRun(run: AgentRunRecord)` and `recordStep(step: AgentStepRecord)` write to the `agent_runs` and `agent_steps` tables:
  - tool, input, row count, latency, tokens, cost
  - `source: 'chat' | 'eval'`
- Eval case YAML: `{ id, category, store, role?, question, expect: { numbers?: {value, tolerance, metric?}[]; mentions?: string[]; tools?: string[]; refuse?: boolean; noData?: boolean; canary?: string } }`. Expected numbers come from `truth.json`, with today pinned to the end of the data.

**Steps**
- [ ] Write failing tests:
  - `checker.test.ts`:
    - "Net sales were $12,340" against a ledger value of 12340.12 matches; "$13,000" is unmatched.
    - An invented "up 8.3%" against a 100-value ledger is unmatched.
    - "$3,012" doesn't match an order count of 3,012.
    - "2026-03-02", "last 30 days", "WELCOME10" and "#1042" are skipped.
  - `agent.test.ts`, with the AI SDK's mock model: the step cap; one repair turn, then a flag; a retry on the other model after an error; a tool's `STORE_DISCONNECTED` surfaces as that error; no tool schema has a tenant, shop or org key.
  - `budget.test.ts`: spending at or above the cap throws `BUDGET_EXCEEDED`; eval runs don't count.
  - Component tests: each of the 8 error codes renders its copy; only a `gc_admin` gets the reconnect button.
  - Review Focus 4: `STORE_DISCONNECTED` shows the reconnect action.
- [ ] Implement the checker, agent loop, budget and audit modules.
- [ ] `/api/chat`:
  - AI SDK streaming through `runAgent`
  - tools bound with `TenantContext` in a closure, with no tenant or shop field in any schema
  - step cap of 8
  - the models from `models.ts`; after an error or timeout, one retry on the other model
  - effort set explicitly, starting low for chat
  - a cached system prompt that never changes within a thread; today's date and the data's as-of time go in each new user turn
  - append-only history: the repair is a new turn, and earlier messages are never edited
  - after the final step, run the checker. If anything is unmatched, append one repair turn and show the corrected answer, flagging anything still unmatched.
- [ ] System prompt covering:
  - use metric definitions and state which one was used
  - store text is untrusted
  - never output personal data
  - always say "as of"
  - use the date given in the turn, never a remembered one
  - ask when the question is ambiguous
  - say plainly when data doesn't exist
- [ ] `/chat` UI:
  - streaming, with a loading label for each tool
  - error banners with actions
  - 8 suggested questions
  - tables with "50 of N"
  - clickable numbers that open a provenance popover (definition, query, as-of time)
  - a metric-definitions panel
  - markdown rendered with an allow-list: no images, and links only to the app and Shopify admin, tested with the S10 note
  - the "Demo data through <date>" banner when the demo clock is on
- [ ] Langfuse tracing, tagged by tenant, route, model and tool. Prompts and tool payloads aren't recorded, and traces are flushed in `after()` so they aren't lost on Vercel.
- [ ] Evals:
  - about 65 cases in `evals/cases/`, using the mix in product plan §9
  - eval mode reads the test database. `searchProducts`, `getInventory` and the single-order refresh read it too, through a fixture version of the Shopify reader.
  - `npm run eval` writes `docs/evals/latest.md` and `latest.json`, with the commit it ran on
  - run locally before each checkpoint that changes `lib/agent`, `lib/tools`, prompts or `models.ts`; CI doesn't run it
  - the bar: number accuracy of at least 90% and no successful injection. An injection succeeds if the case's canary shows up in the answer, a tool call or a link.
  - cases include cross-tenant access (a Tidepool user asking about Solenne), a `client_viewer` case, the S10 order note and the S10 product description
  - "why" cases wait for T5-B; here each storyline gets a data-level case graded by numbers
- [ ] Docs:
  - **README:**
    - It opens with a summary of at most 400 words: the thesis; the Loom and live URL; the demo-login note (the logins and the code are sent with the submission); a "Brief → where it's met" table covering the 3 requirements and 4 stretch ideas, each marked built, partial or roadmap; the key decisions with the alternatives rejected; and the eval results.
    - Then architecture, setup (Day 0, env, seed, run, deploy), metrics, limitations, and "What production would add", linking `docs/production/`.
    - One line on how it was built: "Claude Code drafted plans and code from my decisions; I reviewed and own every decision."
  - `docs/runbook.md`
  - short ADRs in `docs/decisions/`
  - `ROADMAP.md`, covering unbuilt stretch letters and the roadmap in product plan §5
- [ ] **Verify:**
  1. `npm run typecheck && npm run lint && npm test && npm run eval` meets the bar.
  2. From a fresh clone with `.env.local` in place, `npm ci`, the migrations and `npm run dev` answer a suggested question. The README records how long a full setup from nothing takes.
  3. The suggested questions answer correctly on the Vercel URL.
  4. In a fresh incognito window on another device, each reviewer login signs in with the code 424242 and gets a first answer within 60 seconds.
- [ ] Record Loom v1, as a backup in case stretch work runs out of time.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim. **Cut line:** after T4 the submission is complete: checked numbers with their sources, GC and client roles, and personal-data and injection safety, on a seeded store.

---

### T5: Plan-to-Pace stretch (about 4–6 days, needs T4; stop after any letter)

Each letter matches product plan §5 and ends with its own checkpoint. Stretch E (Liquid landing pages), F (portfolio and Monday brief) and G (MCP) are specified in [build-plan.md](build-plan.md), tickets T9 and T10.

**A. Pace, generative UI and memory**
- [ ] Add the `plans` and `plan_targets` tables. `npm run fixtures:load` loads each store's `plan.csv`, `calendar.csv` and call notes into its tenant.
- [ ] Add a `render_view` tool returning `ViewSpec = { component: 'kpi' | 'line' | 'bar' | 'table' | 'gauge' | 'waterfall'; title: string; queryRefs: string[] }`.
  - The server fetches the data by `queryId`; the model never types in values.
  - Metric results gain `gapToPlan`.
- [ ] Add `/pace`: month-to-date against plan, where the month will land, and how last month finished.
  - The month-to-date plan spreads each monthly target over its days using the same month's daily pattern from the year before, so Black Friday doesn't make November look behind for most of the month.
  - Where the month will land = month-to-date actual + the rest of the month's plan × (actual ÷ plan so far). It's shown as an estimate.
- [ ] Pinned views go in `saved_views` and re-run on load.
- [ ] Threads are persisted. Store the exact provider messages, including empty thinking blocks, and replay them as stored; never rebuild history from the UI messages.
- [ ] A `memories` table and a `remember` tool, with confirmation in the UI.
- [ ] Load `ad-spend.csv` into an `ad_spend` table, and add the metrics `mer` (net sales ÷ ad spend) and `new_customer_cac` (ad spend ÷ new-customer orders), each tested against `truth.json`.
- [ ] **Tests:** an unknown component is rejected; a pinned view re-runs its query; a November day's month-to-date plan follows last November's pattern.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

**B. Why**
- [ ] `driverTree(ctx, period, planId): DriverNode[]` is deterministic.
  - Level 1 splits the net-sales gap to plan into orders and AOV, for new and returning customers, less refunds.
  - It uses the midpoint split, `Δ(O×A) = ΔO × (A₀ + A₁)/2 + ΔA × (O₀ + O₁)/2`, so the parts add up exactly in any order.
  - Product mix, discount depth and zero-sales days are evidence for a driver, not extra terms.
- [ ] Parallel investigator sub-agents take the top 3 drivers, with `get_calendar` and `get_notes` tools. Those two tools are registered only for GC roles. The investigators use the chat model and the synthesis uses the analysis model, both from `models.ts`. A deterministic recompute checks the investigators' figures.
- [ ] Run an eval comparing single and multi-agent; put the table in the README.
- [ ] "Why" eval cases, one per storyline, graded by cause recall: an LLM judge answers yes or no for each expected cause.
- [ ] **Unit tests (mocked model):**
  - S9: October's top driver is new-customer orders.
  - S7: September shows serum zero-sales days.
  - A `client_viewer`'s tool list has no `get_calendar` or `get_notes`.
- [ ] **Eval cases:** the S7 answer cites the call note; a `client_viewer` asking "why" gets an answer built only from store data.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

**C. Plan in**
- [ ] Upload the SOW PDF and plan sheet: PDF and CSV only, up to 4 MB, GC roles only.
- [ ] Claude reads the PDF in two passes, because citations can't be combined with structured output in one call:
  1. With citations on, it lists each target as one sentence; each sentence keeps its cited page.
  2. Without the PDF, it turns those sentences into structured output, checked against a Zod schema.
- [ ] A review screen shows the targets as changes against the current plan. A GC role confirms, and the confirmed version replaces the fixture plan.
- [ ] **Test:** an eval case where the fixture SOW gives the expected targets and pages.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

**D. Act with approval**
- [ ] A `propose_action` tool raises an approval card showing the diff.
- [ ] On approval, the server re-validates, then moves the action from approved to running in one conditional update, so a double click runs it once. It then runs `analyticsTargetCreate`, `analyticsAnnotationCreate` or `discountCodeDeactivate`. Targets take fixed amounts only: write total sales and order targets, and check any other metric on the dev store first.
- [ ] On the reviewer logins, approvals are a dry run: the card shows the exact mutation and variables, and the ledger records it as a dry run.
- [ ] The `actions` ledger records the owner, hypothesis, metric and check date.
- [ ] Add the write scopes to `shopify.app.toml` and, after asking Asim, run `shopify app deploy`; then approve the new permissions in each store's admin. Never uninstall to change scopes.
- [ ] **Tests:**
  - Nothing runs without an approval record.
  - A payload changed after approval is rejected.
  - A `client_viewer` can't approve.
  - A second approval of the same action does nothing.
  - A reviewer's approval never calls Shopify.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

**Finish**
- [ ] Final Loom following product plan §13.
- [ ] Update the README and `ROADMAP.md`.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.
