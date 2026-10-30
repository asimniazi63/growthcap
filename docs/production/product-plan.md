# Oasis Pace: Product Plan, Production Version

*2026-10-31. Owner: Asim Hameed Khan. Tickets: [implementation-plan.md](implementation-plan.md). The take-home build follows [../product-plan.md](../product-plan.md). This version designs what Oasis Pace would need to run for GC's real clients. Sections keep the take-home numbering, and a section that doesn't change says so and points to the take-home plan.*

## How this differs from the take-home plan

| Area | Take-home | Production |
|---|---|---|
| Shopify app | Custom distribution on two dev stores | A new public app, because a distribution method can't be changed; expiring offline tokens; Shopify's approval for `read_all_orders` and protected customer data |
| Sign-in | Clerk development instance with test-mode reviewer logins | Clerk production instance on GC's domain with the B2B add-on; invited users; MFA for staff |
| Tenancy | Tenant filter in app code, one isolation test | Row-level security in Postgres; a tenant source defined for every caller; the OAuth install bound to the tenant that started it |
| Sync | Bulk export on connect, on Resync and nightly; one webhook | Every change webhook, processed through a queue after a fast acknowledgement; ordering guards; a 15-minute incremental reconcile |
| Privacy | Compliance webhooks acknowledged and logged | Export and deletion within Shopify's 30 days; keyed pseudonyms; tests over every query and payload; trace retention |
| Models | One retry on another Claude model | Failover to a second provider; refusal handling; effort chosen by evals |
| Evals | Run locally, results in the README | A CI gate with repeated trials, a held-out set and a second data world |
| Operations | A short runbook | Separate environments, backups, measured targets with alerts, a full runbook |
| Product | Stretch A–G at demo quality | The same features hardened: internal-material flags, approval workflows, token-bound MCP; plus accessibility to WCAG 2.2 AA |

## 1–3. Summary, why, users

Same as the take-home plan, §1–§3. In production, GC leadership uses the portfolio (§5 F), and Liam reaches the tools through the MCP server (§5 G).

## 4. Goals, non-goals, anti-goals

**Goals**
1. A GC operator connects a client's store and gets correct, sourced answers within minutes of the first sync.
2. Every number traces back to a written definition and a query.
3. It meets the bar for an Oasis production module: tenant isolation enforced by the database, least privilege, an audit log covering people and agents, gated evals, measured reliability targets and a runbook.
4. The plan-to-pace loop finds the storylines planted in the test data, and gated evals prove it.

**Non-goals**
- billing
- live ad-platform APIs (a CSV in the same shape stands in until a connector is built)
- an embedded admin UI or a Sidekick extension (roadmap)
- mobile layouts
- totals across currencies

**Anti-goals.** The take-home list, plus:
- a client seeing GC-internal material, such as call notes or the analyses that cite them
- keeping a merchant's data after Shopify asks for it to be deleted

## 5. Scope

### Core
- **Connect a store.** A gc_admin installs the public app on a client's store through OAuth. The install is bound to the tenant that started it. Tokens expire and are refreshed under a lock.
- **Keep data current.** Webhooks for every change, processed through a queue; a 15-minute incremental reconcile; a watermark on every answer.
- **Ask and verify.** The take-home agent, tools and number checker (§8), over the same metric layer.
- **Govern.** Roles, row-level security, an audit log of people and agents, and spend caps per tenant and for the organization.
- **Protect.** Compliance webhooks handled within 30 days; no personal data stored, sent to the model or kept in traces.
- **Operate.** Evals as a CI gate; targets measured and alerted; a runbook.

### Polish
The take-home list, plus accessibility to WCAG 2.2 AA on every screen.

### Stretch: Plan-to-Pace (in priority order)

A–G are the take-home plan's §5, with these production additions:
- **A. Pace.** Threads store the exact provider messages, so a resumed conversation replays the history the model saw. The month-end estimate shows a range and is backtested on past months. A per-client setting, off by default, decides whether client viewers see pacing against GC's plan.
- **B. Why.** Answers that cite call notes or calendar notes are marked internal. Internal threads, views and briefs are never shown to client viewers.
- **C. Plan in.** Uploads go to private storage, readable only by GC roles in that tenant.
- **D. Act with approval.** An approval is single-use, bound to its tenant, and expires after 24 hours. Before running, the server checks the store hasn't changed since the proposal. Shopify writes are retried only when nothing could have run (a throttle), so a write never runs twice. A scheduled job grades each ledger entry on its check date.
- **E. Liquid landing pages.** Theme writes go only to an unpublished theme, publishing stays a manual step in the Shopify admin, and every write uses the same approval rules as D.

**F. Operate across clients.**
- A staff-only portfolio ranks every client the user can access by dollars behind plan and shows the top driver for each.
- A Monday brief is drafted per client by a scheduled workflow, checked by the number checker, approved by a strategist, then posted to Slack with link previews off. It can't be approved while any number is unmatched.
- Briefs go to GC staff. A brief reaches a client only after a strategist marks that version client-ready, and a client-ready brief never includes internal material.

**G. Oasis MCP server.**
- The same read tools, tenant guard and audit log, for Liam and GC staff.
- Each MCP token is bound to one client org at consent. Switching clients means a new consent, and no tool takes a tenant argument.
- Over MCP, Oasis vouches for its tool results only. Liam writes its own prose, and the docs say so.

### Roadmap
The take-home plan's roadmap (§5).

## 6. Test data and the demo environment

The seeded stores, storylines, fixtures, ground truth and seeding mechanics are the take-home plan's §6. Production adds:
- **A demo environment that stays current.** A scheduled job tops up the demo stores daily, using a seeder token kept in the platform's secret store, which only works for those two stores. A failed top-up alerts on-call, and the take-home's demo clock covers the gap until it's fixed.
- **A second data world.** A second generator seed with different storylines, used only for the held-out eval set (§9), so prompt tuning can't overfit the planted stories.
- **Staging stores.** Staging runs against its own pair of seeded dev stores, never the demo pair.
- **No demo clock outside the demo.** In production, today is always the store-local date.

## 7. Architecture

```
Browser (GC staff, client viewers)         Claude (Liam) over MCP
   │  Clerk session (production instance)     │  Clerk OAuth token bound to one org
   ▼                                          ▼
Next.js app on Vercel (Pro)
   ├─ /chat, /pace, /portfolio   agent loop → tools → metric layer
   ├─ /connect                   OAuth install bound to the tenant that started it
   ├─ /api/webhooks              verify HMAC → record → 200 within a second → queue
   ├─ queue consumer             re-fetch by ID → map → upsert if newer
   ├─ /api/cron/*                15-minute reconcile, inventory snapshot, retention,
   │                             Monday brief (CRON_SECRET; each slot runs once)
   └─ /api/mcp                   MCP server
        │                                   │
        ▼                                   ▼
Neon Postgres (row-level security)     Vercel AI Gateway → Claude (Bedrock, then a second provider)
  synced data, metric layer,           Langfuse (masked, 30-day retention)
  audit, spend ledger, actions
        ▲
        │ bulk export on connect (bulk_operations/finish), webhooks, 15-minute reconcile
Shopify Admin GraphQL API (pinned 2026-10) ── client stores (public app)
```

### Tenancy and identity
- Each client brand is a Clerk Organization, and a `tenants` row is the source of truth. Only a gc_admin action creates a tenant row, never a first visit.
- A Clerk production instance on a GC domain, with the B2B add-on for custom roles. Sign-up is invitation-only, users can't create organizations, and staff use MFA.
- gc_admin's "all clients" comes from automatic membership in every client org, never from a bypass.
- **Every caller has one tenant source:**

  | Caller | Tenant comes from | Checked by |
  |---|---|---|
  | Signed-in user | The session's active org, which must match the org the page was rendered for | A mismatch (another tab switched org) gets a 409 before any tool runs |
  | Shopify webhook | The shop domain, after HMAC verification | The shop's connection row |
  | Scheduled job | The job's tenant list, one tenant per run | `CRON_SECRET`, and a claimed run row so each slot runs once |
  | MCP client | The org bound to the token at consent | Tokens without an org are rejected |
  | Portfolio | The orgs the user belongs to | Each tenant queried under its own context |

- **Row-level security.** Every tenant table has `tenant_id NOT NULL` and a policy on `current_setting('app.tenant_id')`, which each request sets inside its own transaction. The app connects as a restricted role, because Neon's owner role bypasses row-level security. App code still filters by tenant; the policy catches the query that forgets.
- One connected store per tenant in v1, enforced by a unique index. Several stores per brand, such as regional or wholesale stores, is on the roadmap, with a store selector that's never a tool argument.

### Shopify connection
- **A public app.** The take-home's custom app can't become public, because a distribution method can't be changed, so production is a new app with fresh installs. Shopify's terms allow a custom app on only one merchant.
- **Expiring offline tokens:** a 1-hour access token and a 90-day refresh token. They're required for new public apps now and for every public app from 2027-01-01. A refresh takes a row lock, so two requests never refresh at once and retire each other's token.
- **Approvals before launch:** `read_all_orders`, and protected customer data at Level 1 with no name, email, phone or address fields.
- **Install binding.** `/api/shopify/install` records the tenant, user and shop for 10 minutes. The callback uses that record, not whichever org is active when Shopify redirects back, checks the granted scopes, and refuses a shop that belongs to another tenant.
- **Client-secret rotation.** Webhooks are verified against both the current and the previous secret until the old one is revoked.

### Data and sync
- **Bulk export on connect.** Completion arrives through `bulk_operations/finish`, with a poll of `bulkOperation(id:)` as a fallback. Result files expire after a week, so a failed import restarts the export.
- **Webhooks:** `orders/create`, `orders/updated`, `orders/delete`, `refunds/create`, `products/create`, `products/update`, `products/delete`, `inventory_levels/update`, `inventory_items/update`, `app/uninstalled`, `bulk_operations/finish` and the three compliance topics.
- **Fast acknowledgement.** The webhook route verifies the HMAC, records the event and returns 200 within a second. A queue consumer re-fetches the object by ID through GraphQL and upserts it with the same mapper as the bulk export, skipping it if the stored row is newer, because Shopify doesn't guarantee delivery order. A failed event is retried until it succeeds or is parked for review.
- **Reconcile every 15 minutes.** It fetches everything updated since the last watermark, which covers missed and failed webhooks. Shopify retries a failing delivery for 4 hours and doesn't remove subscriptions declared in `shopify.app.toml`, so after an outage the reconcile re-imports the window.
- **Watermark.** Every answer shows `synced_through`. `DATA_STALE` fires when it's more than 26 hours old, a webhook has sat unprocessed for 15 minutes, or the last sync run failed.
- **Dates:** the take-home rule (`processedAt` for orders and refunds, in the store's timezone).
- **Live lookups degrade.** If a live call is throttled, fails or takes more than 1.5 seconds, the tool returns the synced rows with their age and a `DATA_STALE` warning instead of an error.

### Privacy and data handling
- **Pseudonyms.** Customers are `CUST_` plus 12 hex characters of an HMAC of the tenant and the Shopify customer ID, under a secret key. Rows are keyed internally by the Shopify customer ID, so two customers can never merge, and a collision check runs at sync.
- **No personal data in.** Checked-in GraphQL documents never select names, emails, phones or addresses, and a test enforces it. Webhook handlers re-fetch by ID, so full payloads, which carry personal data, are never stored.
- **Compliance webhooks:**
  - `customers/data_request`: an export of that customer's pseudonymous orders, sent to the store owner within 30 days.
  - `customers/redact`: the customer row is deleted and their orders get a tombstone ID, so totals stay right. Threads and traces that cite the ID are deleted.
  - `shop/redact`, 48 hours after an uninstall: every Shopify-derived row for the shop is deleted, unless the store has been reinstalled since.
  - Each request is recorded with its completion time.
- **After an uninstall**, tools return `STORE_DISCONNECTED` straight away. Shopify's API Terms require deleting the merchant's data within 30 days, which `shop/redact` covers.
- **Traces.** Langfuse gets masked traces (no prompts or tool results) and keeps them 30 days. AWS (for Bedrock) and Langfuse are listed as sub-processors.
- **No training on client data.** Merchant data is never used to tune prompts or models without the merchant's consent, as Shopify's API Terms require. Eval cases come only from synthetic data.
- **Backups and retention.** Neon's restore window plus a daily dump stored outside Neon. Webhook events are kept 30 days, agent step inputs 90 days and audit events a year.

### Roles and access
The take-home table (§7), plus portfolio access and brief approval for GC roles, and:
- An `internal` flag on any thread, view or brief that cites agency-internal material. Client viewers never see internal items.
- `audit_events` records people's actions: connecting and disconnecting stores, role changes, approvals, executions, exports, uploads and compliance handling. The app's database role can insert audit rows but can't change or delete them.

### Inventory and traffic
With `read_reports` and Level 2 customer data, ShopifyQL's inventory and sessions data would replace the take-home's inferred stockouts and add conversion to the driver tree. It's a per-client decision, because Level 2 means more personal-data access.

### Permissions
Core scopes are the take-home's, with `read_all_orders` approved. Stretch D adds `read_reports`, `write_reports`, `write_analytics_annotations` and `write_discounts`, and stretch E adds the theme and page write scopes. A scope change is deployed and approved by each merchant in their admin; the app is never uninstalled to change scopes.

### Environments

| Environment | Shopify app | Stores | Database | Clerk |
|---|---|---|---|---|
| Development | Dev app | A dev-only store | A Neon branch | Development instance |
| Staging | Staging app | Its own pair of seeded dev stores | A Neon branch | Development instance |
| Demo | The take-home's custom app | Solenne and Tidepool | Its own branch | Development instance |
| Production | The public app | Client stores | Neon main | Production instance |

- Each Shopify app has its own `shopify.app.<env>.toml`, so `shopify app dev` never touches a demo or client store.
- Preview deployments get no webhooks or cron; Vercel Cron calls production only.
- Migrations run before each deploy and stay compatible with the previous release.

## 8. Agent design

Same as the take-home plan §8 (models, tools, metric definitions, number checker, safety, errors), with these production changes.

**Models**
- Calls go through Vercel AI Gateway: Amazon Bedrock first, with a second provider for the same models (the Claude API, or Google Cloud once it's confirmed the 5.5 models are served there) for a Bedrock outage.
- Effort for each use is chosen by evals on accuracy and time to first output.
- **Refusals.** A model can decline mid-stream (finish reason `content-filter`). The partial text is discarded, the checker is skipped, and the user sees `MODEL_REFUSED`.
- **Quotas.** Bedrock throttling and quota errors map to `MODEL_UNAVAILABLE` after retries, alert on-call, and tell the user when to try again.
- The 5.5 models reject sampling parameters, so no call sets a temperature. Evals use repeated trials instead (§9).

**Metric definitions.** The take-home table, plus rules real stores need:
- tax-inclusive prices (UK, EU and Australian brands): tax is taken out of the line price
- tips are excluded
- order edits and exchanges count on the edit date
- refunds of an amount with no line items count in `refunds` but not in `refund_rate`
- orders with no customer are left out of customer metrics, and the answer shows the coverage
- cancelled orders are reported separately, so totals can be reconciled with Shopify Analytics

**Number checker.** The take-home design, plus:
- It runs inside the shared agent loop, so chat, the Monday brief and evals all get it.
- Over MCP it checks Oasis's tool results; Liam's own prose isn't covered.

**Safety.** The take-home rules, plus:
- The browser sends only `{ threadId, message }`. The server loads the thread's history for that tenant and user, so a client can't forge earlier tool results.
- A Content Security Policy built from Clerk's published requirements, tested with sign-in and chat.
- Slack posts have link previews off, so an injected URL is never fetched.

**Typed errors.** The take-home's 8, plus:

| Error | What the user sees |
|---|---|
| `MODEL_REFUSED` | "I can't answer that one. Try rephrasing." |
| `MODEL_UNAVAILABLE` | The AI service is unavailable, with when it's expected back |

## 9. Quality

**Unit and integration tests.** The take-home tests, plus:
- **Row-level security:** a query run as Tidepool with its tenant filter removed still returns no Solenne rows.
- **Roles:** `gc_partner` and `client_viewer` get 403 from connect, resync and spend-cap actions; a `client_viewer` never sees an internal item.
- **Compliance:** all three handlers, including `shop/redact` after a reinstall.
- **Webhooks:** an older update never overwrites a newer row; a failed event is retried; a webhook signed with the previous secret verifies during a rotation.
- **Jobs:** cron routes return 401 without `CRON_SECRET`, and a slot runs once.
- **Tokens:** concurrent requests refresh an expiring token once.
- **Accessibility:** axe checks in component tests, and keyboard tests for the provenance popover.

**End-to-end**
- A Playwright smoke test, using Clerk's testing helpers, signs in, asks a suggested question, and opens a table and a provenance popover, against a mocked model on every pull request.
- Before each release, a live smoke test triggers a webhook on staging and checks it lands.

**Evals**
- **Tier 1, every push, free:** typecheck, lint, unit tests and replays of recorded model transcripts.
- **Tier 2, paid:** the full eval set, 3 trials, on pull requests that change the agent, tools, prompts or models, and on demand. It gates on mean number accuracy across trials and zero successful injections. It uses its own AWS credentials and budget, never the production tenants'.
- **Held-out set:** about 15 cases written before any prompt work, on the second data world (§6), run only at release checkpoints and reported separately.
- **Controls:** 3–5 "nothing unusual happened" cases and a calendar event that didn't matter, so overclaiming is penalised.
- **Injection:** about 50 attempts across order notes, product descriptions, tags, discount titles, line-item properties, the SOW and call notes. With 0 of 50 succeeding, the true rate is bounded near 6%; 0 of 10 bounds it only near 26%.
- The README reports first-run accuracy next to the figure after retries.

**Observability**
- Langfuse traces, masked, tagged by tenant, route, model and tool.
- `agent_runs` gains tenant, actor, status, error code and `ttft_ms`; `agent_steps` gains `error_code`. With `audit_events`, they make up the audit log.

## 10. Reliability and operations

**Targets, and where each is measured**

| Target | Measured from |
|---|---|
| Sync lag under 15 minutes (p95) | Webhook processing time minus Shopify's triggered-at time, and the reconcile's lag |
| Time to first visible output under 3 seconds (p95) | `agent_runs.ttft_ms`: request received to the first tool label or text |
| Tool error rate under 2% | `agent_steps.error_code` over tool steps |
| Webhook acknowledged within 5 seconds | `webhook_events`, and Shopify's delivery metrics, which report p90 |

**Alerting.** A daily health summary goes to the ops Slack channel. On-call is paged when a target is breached for 15 minutes, the queue backs up, a sync fails twice, or a compliance request nears its 30-day deadline.

**Spend.** Each tenant's daily cap is a setting (default $10, UTC day) that a gc_admin can change. An expensive run reserves its estimated cost first, so concurrent runs can't overshoot. An organization-wide daily ceiling and an AWS Budgets alert sit above the tenant caps.

**Runbook** (`docs/runbook.md`):
- token revoked or app uninstalled
- expiring-token refresh failures
- Shopify throttling, and a stuck or failed bulk export
- failing webhook deliveries (TOML subscriptions stay; the reconcile re-imports the window)
- `DATA_STALE` triage
- rotating the token-encryption key, the pseudonym key and the Shopify client secret
- a Neon outage, and restoring from backup
- a Clerk outage (sign-ins stop; nothing to fix in Oasis)
- a Langfuse outage (chat keeps working; traces are dropped)
- a Bedrock outage (gateway failover), and budget exhaustion at the tenant or organization level
- missed or doubled cron runs
- compliance requests and `shop/redact`
- a Slack failure for the Monday brief
- a failed top-up in the demo environment

## 11. Decisions

These add to the take-home decisions (§11).

| Decision | Choice | Alternatives rejected | Why |
|---|---|---|---|
| App distribution | A public app | A custom app per client | Shopify's terms allow a custom app on one merchant only, and a distribution method can't be changed later |
| Tenant isolation | Row-level security plus app-level filters | App-level filters only | One forgotten filter would show one brand another's data |
| Webhooks | Acknowledge fast, process through a queue | Apply inside the request | Shopify allows 5 seconds; a cold start and a slow database can miss it, and a failure inside the request is lost |
| Sync freshness | Webhooks plus a 15-minute reconcile | A nightly reconcile | Webhooks can be missed, and a day's lag breaks the 15-minute target |
| Model failover | AI Gateway with a second provider | A second Claude model on the same API | A different model on the same provider goes down with it |
| Eval gate | Paid evals in CI with repeated trials | Local evals only; a single trial | Model output isn't deterministic, and one trial on about 45 number cases is mostly noise |
| Pseudonyms | A keyed HMAC, 12 hex characters | A plain hash, 8 hex characters | A plain hash of guessable IDs can be reversed, and 8 characters collide at real-client sizes |
| Inventory and traffic | Inferred stockouts by default; ShopifyQL per client | ShopifyQL for every client | ShopifyQL needs Level 2 customer data |
| MCP tenancy | One org per token | A tenant argument on each tool | Arguments must never choose the tenant |

## 12. Risks

1. **Shopify approvals.** `read_all_orders`, protected customer data and the public app's review can take weeks. Apply early, and launch inside the 60-day order window if needed.
2. **The 2027-01-01 token deadline** applies to every public app. The connections table already holds refresh tokens.
3. **Scale.** A client with more than 100k orders needs a chunked bulk import and a paged reconcile. Test it on a large staging store before onboarding one.
4. **Model cost** at real usage. The caps hold, but the default may be too low for busy clients; review it monthly.
5. **Metric Targets** take fixed amounts only and document total sales and orders, so rate targets stay in Oasis.
6. **Definitions against Shopify.** Clients will compare with Shopify Analytics, so every difference is listed in `docs/metrics.md` and shown next to the number.

## 13. Rollout

1. Staging with the seeded stores: the tier-2 eval gate and the held-out set pass.
2. One pilot client, for GC staff only, for two weeks. Answers are compared with Shopify Analytics daily.
3. Client viewers for the pilot client, with pacing visibility off until a strategist turns it on.
4. More clients in batches, watching cost, sync lag and error rates per tenant.

## 14. Left to the builder

Same as the take-home plan §14.
