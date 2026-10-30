# Oasis Pace Implementation Plan, Production Version

> **For agentic workers:** Reference material. Don't build from this plan unless Asim asks. When asked, follow it with the same rules as the take-home plan: never stage, commit or push, and stop at each checkpoint.

**Goal:** Run Oasis Pace for GC's real clients: the take-home build, plus the production design in [product-plan.md](product-plan.md).

**How to read it:** each ticket starts from the take-home ticket of the same name in [../implementation-plan.md](../implementation-plan.md) and lists what changes. Items marked **Replace** swap a take-home step; everything else is added.

**Spec:** [product-plan.md](product-plan.md), with [../product-plan.md](../product-plan.md) for the sections that don't change.

## Global Constraints

The take-home constraints apply, with these changes:
- **Node.js 26.x**, pinned in `engines`, `.nvmrc` and CI, matching Vercel's default runtime.
- **Store dates.** No demo clock outside the demo environment: today is the store-local date.
- **One tenant source per entry point:**
  - `tenantFromSession()` for signed-in users
  - `tenantFromShop(domain)` for HMAC-verified webhooks only
  - `tenantForJob(tenantId, job)` for cron routes, after the `CRON_SECRET` check
  - `tenantFromMcpToken(token)` for MCP
  - `listAccessibleTenants(userId)` for the portfolio
  - Every query runs in a transaction that sets `app.tenant_id` for row-level security.
- **Customers** are `CUST_` plus 12 hex characters of `HMAC-SHA256(PSEUDONYM_KEY, tenantId:shopifyCustomerId)`, unique per tenant.
- **Spend:** `tenants.daily_cap_usd` (default 10, UTC day), reserved before expensive runs, under an organization-wide ceiling. Evals use their own key and budget.
- **Errors:** 10 codes, the take-home 8 plus `MODEL_REFUSED` and `MODEL_UNAVAILABLE`. `DATA_STALE` is a warning field on results (`warnings: ('DATA_STALE' | 'BUDGET_80')[]`), never a thrown error.
- **`DATA_STALE`** fires when `synced_through` is more than 26 hours old, a webhook has been unprocessed for 15 minutes, or the last sync run failed.
- **Shopify calls.** Queries retry throttles, 5xx responses and network errors with jittered backoff until a deadline (4 seconds in chat, 60 in sync). Mutations retry only on a throttle, or when they carry an `@idempotent` key.
- **Telemetry** records no prompts, inputs or outputs. Langfuse keeps traces 30 days.
- **History.** The browser sends only `{ threadId, message }`. The server loads and appends the history, and never rebuilds it from UI messages.
- **Done-check:** `npm run typecheck && npm run lint && npm test`, plus the tier-2 eval gate for any change to the agent, tools, prompts or models.

## Review Focus

The take-home's five, plus:

| # | Situation | Expected behavior | Test owned by |
|---|---|---|---|
| 6 | Two requests refresh the same expiring token at once | One refresh; both requests use the new token | T1 |
| 7 | An `orders/updated` delivery arrives after a newer one | The older update is skipped | T3 |
| 8 | `shop/redact` arrives after the store was reinstalled | Nothing is deleted, and the request is logged | T3 |
| 9 | A user switches org in another tab mid-thread | The next message gets a 409, not the other brand's data | T4 |
| 10 | A query is missing its tenant filter | Row-level security returns nothing from other tenants | T3 |

## File Structure: additions to the take-home tree

```
lib/tenancy/{actors,rls}.ts                  tenant sources, per-transaction tenant setting   T1
lib/shopify/{tokens,rotation}.ts             expiring-token refresh under a lock, dual-secret HMAC   T1
lib/audit/events.ts                          audit_events for people's actions               T1
lib/queue/*                                  webhook queue consumer (Vercel Queues or Workflows)   T3
lib/sync/{reconcile,watermark}.ts            15-minute incremental reconcile                 T3
lib/privacy/{compliance,pseudonym,retention}.ts                                              T3
lib/agent/gateway.ts                         AI Gateway models and provider order            T4
app/api/cron/{reconcile,snapshot,retention,brief}/route.ts   (replaces cron/refresh)         T3/T5
app/(app)/portfolio/page.tsx                 stretch E                                       T5
app/api/mcp/route.ts, app/.well-known/*      stretch F                                       T5
e2e/*.spec.ts                                Playwright smoke tests                          T4
.github/workflows/evals.yml                  tier-2 eval gate                                T4
shopify.app.{dev,staging,production}.toml    one Shopify app per environment                 T1
```

**Order:** the same as the take-home plan, with a longer Day 0.

---

### Day 0: Accounts and environments

The take-home Day 0, plus:
- [ ] Use a Partner organization for the public app. File the `read_all_orders` and protected-customer-data requests before launch, because approval can take weeks.
- [ ] Create the public production app, plus separate dev and staging apps, each with its own `shopify.app.<env>.toml`.
- [ ] Clerk production instance on a GC domain (DNS records), with the B2B add-on for custom roles, invitation-only sign-up and MFA for staff.
- [ ] Vercel Pro, for cron runs more often than daily and longer functions, with production, staging and preview environments.
- [ ] A Neon paid plan for a longer restore window, with a branch per environment and a restricted application role that doesn't bypass row-level security.
- [ ] AWS: separate IAM credentials for production and for evals, each with its own Budgets alert. Vercel AI Gateway with Bedrock first and a second provider (the Claude API or Google Cloud).
- [ ] Langfuse Pro (for retention policies), or a self-hosted Langfuse.
- [ ] Extra secrets: `PSEUDONYM_KEY`, `TOKEN_KEYS` (versioned) with `TOKEN_KEY_CURRENT` in place of `TOKEN_ENCRYPTION_KEY`, and `SHOPIFY_API_SECRET_PREVIOUS` during a rotation.

---

### T1: Platform foundation

The take-home T1, with these changes.

**Interfaces added**
- `type Actor = { kind: 'user'; userId: string; role: Role } | { kind: 'shopify'; shopDomain: string } | { kind: 'system'; job: 'reconcile' | 'snapshot' | 'retention' | 'brief' } | { kind: 'mcp'; userId: string; clientId: string }`
- `tenantFromSession()`, `tenantFromShop(domain)`, `tenantForJob(tenantId, job)`, `tenantFromMcpToken(token)` and `listAccessibleTenants(userId)`
- `withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T>` sets `app.tenant_id` for the transaction
- `encryptSecret(plain: string, aad: string): EncryptedSecret` uses a fresh 12-byte IV, a 16-byte tag, and the tenant, shop and column as additional authenticated data. Keys come from `TOKEN_KEYS` by version.
- `getAccessToken(conn: ShopConnection): Promise<string>` refreshes an expiring token under `SELECT … FOR UPDATE`
- Tables: `connect_intents (id, tenant_id, user_id, shop_domain, expires_at)`, `audit_events (id, tenant_id, actor, action, target, at, metadata)` and `job_runs (job, slot, started_at, finished_at)`

**Steps**
- [ ] **Replace** the OAuth step. `/api/shopify/install` (gc_admin only) writes a `connect_intents` row and sets a signed, httpOnly cookie with its ID. The callback uses that row's tenant and user, checks the granted scopes, and rejects a shop bound to another tenant. The token exchange asks for an expiring offline token, and the refresh token and expiry are stored.
- [ ] **Replace** the webhook pipeline. Verify the HMAC on the raw body against the current and previous secrets, insert with `ON CONFLICT DO NOTHING`, return 200 and enqueue. The consumer processes an event while its `processed_at` is null.
- [ ] Row-level security policies on every tenant table, created by the migrations. The app connects as the restricted role.
- [ ] `npm run keys:rotate` re-encrypts every token under a new key version.
- [ ] Every cron route checks `Authorization: Bearer ${CRON_SECRET}` with a timing-safe compare, then claims its slot in `job_runs`.
- [ ] `audit_events` rows for connecting, disconnecting and role changes. The app's role can insert them but not update or delete them.
- [ ] **Tests added:**
  - Row-level security holds with the tenant filter removed.
  - Concurrent requests refresh a token once (Review Focus 6).
  - The callback rejects an expired intent or one from another user.
  - A cron call without the secret gets 401, and a repeated slot is skipped.
  - A webhook signed with the previous secret verifies during a rotation.
  - A secret encrypted for one tenant fails to decrypt with another tenant's additional data.
- [ ] **Verify added:** start an install on staging, switch org in another tab before approving, and confirm the store lands in the tenant that started the install.

---

### T2: Test stores and ground truth

The take-home T2, with these changes:
- [ ] A second generator seed and storyline set ("world 2") for the held-out eval set. It's generated as fixtures only and never loaded into the demo stores.
- [ ] A scheduled job tops up the demo stores daily, with the seeder token in the secret store, and alerts on failure.
- [ ] The pilot runs on a scratch dev store, so pilot orders never touch the demo stores.

---

### T3: Sync, metric layer and privacy

The take-home T3, with these changes.

**Steps**
- [ ] **Replace** the single `orders/create` subscription with the full topic list in product plan §7. Add it to each environment's TOML and deploy.
- [ ] **Replace** the nightly refresh with:
  - the queue consumer: re-fetch by ID, map with the bulk mapper, and upsert only if `updated_at` is newer
  - `bulk_operations/finish` handling, with a `bulkOperation(id:)` poll as the fallback
  - a 15-minute incremental reconcile from the `synced_through` watermark
  - the nightly inventory snapshot and retention jobs
- [ ] Compliance handlers (product plan §7): the export, redaction with tombstone IDs, and `shop/redact` with the reinstall guard. `compliance_requests` gains `completed_at`.
- [ ] Keyed pseudonyms, with a collision check at sync.
- [ ] After an uninstall, every tool returns `STORE_DISCONNECTED`. Data is deleted on `shop/redact`, or after 30 days at the latest.
- [ ] Live lookups fall back to synced rows with a `DATA_STALE` warning when the call fails or takes more than 1.5 seconds.
- [ ] The real-store metric rules from product plan §8 (tax-inclusive prices, tips, edits, refunds without line items, orders without a customer), each with a test.
- [ ] **Tests added:**
  - Review Focus 7, 8 and 10.
  - A redaction removes the customer from every table, thread and trace.
  - A scan of every mapped row for email and phone patterns.
- [ ] **Verify added:** stop the queue consumer on staging for 20 minutes; the reconcile catches up and `DATA_STALE` clears.

---

### T4: Agent workspace, quality and release

The take-home T4, with these changes.

**Steps**
- [ ] `lib/agent/gateway.ts`: models through Vercel AI Gateway with a second provider, plus `MODEL_REFUSED` and `MODEL_UNAVAILABLE` handling. Partial text from a refusal is discarded.
- [ ] Threads are persisted from T4. The client sends `{ threadId, message }` through `prepareSendMessagesRequest`; the server loads the history for that tenant and user and validates it with `validateUIMessages`.
- [ ] Each request carries the org its page was rendered for. A mismatch with the session's active org gets a 409 (Review Focus 9).
- [ ] The checker's extractor classifies every number (money, count, percent, date, ID or ordinal), and every ledger value carries its unit.
- [ ] Accessibility, to WCAG 2.2 AA:
  - one polite status region announces tool labels and "Answer ready", not the streamed text
  - error banners use `role="alert"` and a focusable action
  - provenance numbers are buttons with accessible names that open on Enter or Space and close on Escape
  - flagged numbers show an icon and text, not colour alone
  - every chart has a table or text summary beside it
  - axe checks run in the component tests
- [ ] **Replace** local-only evals with the two CI tiers (product plan §9). `evals.yml` runs tier 2 on pull requests that touch `lib/agent`, `lib/tools`, prompts or `models.ts`, and on `workflow_dispatch`, with a concurrency group, a timeout and a cost cap per run.
- [ ] The held-out set, the control cases, and injection cases across seven vectors.
- [ ] The Playwright smoke test runs in CI with a mocked model.
- [ ] `agent_runs` gains `ttft_ms`, `status`, `error_code` and the actor, and a daily health summary goes to Slack.
- [ ] `docs/runbook.md` covers every item in product plan §10.
- [ ] **Verify added:** the tier-2 gate passes on 3 trials; the smoke test passes; a forced Bedrock error fails over through the gateway.

---

### T5: Plan-to-Pace stretch

The take-home T5 A–D, with the production additions in product plan §5: exact provider messages and a backtested month-end range (A), the internal flag (B), private storage for uploads (C), and single-use, tenant-bound, expiring approvals with a drift check and safe retries (D). Plus E and F.

**E. Operate**
- [ ] `/portfolio` ranks the tenants from `listAccessibleTenants(userId)` by dollar gap to plan, querying each one under its own tenant context.
- [ ] Monday brief: a cron route (checked against `CRON_SECRET`, one slot a week) starts a Vercel Workflow per tenant. The workflow drafts the brief through `runAgent`, so the number checker runs; waits for approval with a workflow hook; then posts a templated Slack message with link previews off. A brief with an unmatched number can't be approved.
- [ ] **Tests:**
  - The ranking order with fixtures.
  - A `client_viewer` gets 403 on `/portfolio`.
  - A brief is never posted without approval.
  - An unmatched number blocks approval.
  - A client-ready brief contains no internal material.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

**F. MCP**
- [ ] Spike first: confirm that Clerk's SDK exposes the token's org when it verifies an OAuth token.
- [ ] `/api/mcp` exposes the read tools behind Clerk OAuth. Clients request `user:org:read` with the consent screen on, so each token is bound to one org; tokens without an org are rejected. Only pre-registered OAuth clients are accepted.
- [ ] The same tenant guard and audit log (`source: 'mcp'`, with the client ID in the actor).
- [ ] **Tests:** an MCP call appears in `agent_steps` with its actor; a token bound to Solenne can't read Tidepool; a token without an org is rejected.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.

**Finish**
- [ ] The take-home finish steps, plus a release checklist: the tier-2 gate, the held-out set, both smoke tests and a runbook dry run.
- [ ] **Checkpoint:** stop. List the changed files and suggest a commit message for Asim.
