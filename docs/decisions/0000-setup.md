# 0000: Accounts and setup (T0)

*Done 2026-10-31. Records the non-secret values T1–T4 need and where T0 departed from [build-plan.md](../build-plan.md). Secrets live only in `.env.local`.*

## Values

| What | Value |
|---|---|
| Solenne shop domain | `solenne-cmlzfrsf.myshopify.com` (America/New_York, USD, US, Plus dev store) |
| Tidepool shop domain | `tidepool-xp3ikn15.myshopify.com` (America/Los_Angeles, USD, US, Plus dev store) |
| Shopify Admin API version | `2026-10`, on both apps' active versions |
| Product app | Oasis Pace, version `oasis-pace-2`: not embedded; `read_products,read_orders,read_customers,read_inventory,read_discounts` |
| Seeder app | Oasis Pace Seeder, version `oasis-pace-seeder-1`: not embedded; `write_products,write_inventory,write_locations,write_discounts,write_customers,write_orders,read_reports` |
| App URL | `https://oasis-pace.vercel.app` (Vercel project `oasis-pace`, Hobby, linked to `asimniazi63/growthcap`) |
| Clerk orgs | Solenne `org_3LR4NoXDxJJazTxBV4Pl0pNaD0t`, Tidepool `org_3LR4O1JxW8XkFxIA7LP8HJsiDyk` |
| Clerk role keys | `org:gc_admin`, `org:gc_partner`, `org:client_viewer` |
| Neon | Project `oasis-pace`, AWS us-east-1, Postgres 18.6, database `neondb`, pooled connection |
| AWS region | `eu-central-1` |
| Model, in use until Claude access is granted | `mistral.devstral-2-123b` (in-region) |
| Claude Sonnet 5.5 (chat) | `global.anthropic.claude-sonnet-5-5` |
| Claude Opus 5.5 (analysis) | `global.anthropic.claude-opus-5-5` |
| Claude Haiku 5.5 (summaries) | `global.anthropic.claude-haiku-5-5` |

The three Claude IDs are system inference profiles listed as ACTIVE in eu-central-1, and `eu.` versions exist too. They return 403 for this account until AWS grants access (see Models below).

Memberships: Asim is `org:gc_admin` in both orgs. `reviewer-gc+clerk_test@example.com` is `org:gc_partner` in both. `reviewer-client+clerk_test@example.com` is `org:client_viewer` in Solenne only.

## Decisions and departures from the T0 checklist

**Shopify identity verification.** It was never triggered, because both apps installed without a prompt.

**App distribution: deferred.** The checklist says to pick custom distribution for both apps. That choice can't be undone, and custom distribution covers one store, or several stores in the same Plus organization. Instead:
- Both apps were installed on both stores from the Dev Dashboard's Installs card, with no distribution chosen.
- A read-only probe (client credentials grant, then `orders(first: 1)` and `customers(first: 1)`) succeeded for both apps on both stores.
- The stores were empty at the time, so the T1 pilot was the real test. It did get a "not approved to access the Customer object" error, but for the seeder's unset data use, not for distribution. Selecting Level 1 data use for the seeder fixed it (see Protected customer data below), so **custom distribution stays unchosen** and `read_all_orders` stays deferred. See [0001-day1-spikes.md](0001-day1-spikes.md).

**`read_all_orders`: deferred.** In the Partner Dashboard, the request sits behind "Choose your distribution model before requesting". The scope isn't needed yet, because imported orders are readable for 60 days. Spike (a) in T1 records whether older backdated orders can be read.

**Protected customer data.**
- Product app: Level 1 is selected in the Partner Dashboard, with no Name, Email, Phone or Address fields. The reasons were narrowed to what the app does (analytics, app functionality, and optionally store management). It stays a Draft, because apps installed only on dev stores need no review.
- Seeder: left unset in T0, and the first pilot run was refused on the Customer object (customers and orders were denied on reads too). After the same Level 1 data-use selection in the Partner Dashboard (no fields, Draft), reads worked and the pilot loaded 22 customers created from an `@example.com` address only, with no Level 2 field and no custom distribution.

**App URL is a placeholder.** Both app versions use `https://shopify.dev/apps/default-app-home` and have no redirect URLs. In T2, `shopify app config link` and `shopify app deploy` set the Vercel URL and the redirects from `shopify.app.toml`.

**Vercel's first deploy failed on purpose.** It was imported with the Next.js preset before any app code existed, so the build failed and nothing is served: `/` and `/docs/*` return `DEPLOYMENT_NOT_FOUND`. Every push to `main` fails the same way until T2 scaffolds the app.

**Clerk.**
- Roles, users, orgs and memberships were created through the Backend API, not the dashboard.
- Role keys carry Clerk's `org:` prefix, so `getTenantContext()` strips it or maps it. The built-in `org:admin` and `org:member` roles remain, because Clerk uses them as the creator and default roles. The app must treat them as no access.
- Sign-in is by email code only, with no passwords. Sign-up is invite-only, and org membership is required.
- Users can't create orgs. The reviewers can't delete their accounts, and no user can change their email.
- Org slugs are disabled on this instance, so the orgs have none.

**Neon runs Postgres 18; tests run PGlite.** Check PGlite's Postgres version in T2 and avoid features only Postgres 18 has, such as the built-in `uuidv7()`. `DATABASE_URL` is the pooled connection string.

**Bedrock authentication: an API key, not an access key pair.**
- `AWS_BEARER_TOKEN_BEDROCK` replaces `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in the T1 variable list, and `.env.example` in T2 should list it instead.
- The AI SDK's Bedrock provider reads the variable itself. T4 also passes `region` explicitly from `AWS_REGION`.
- A Bedrock API key can't call STS, so the planned `aws sts get-caller-identity` check doesn't apply.

**The Bedrock key is shared with another project.** Asim chose to reuse an existing long-term key rather than create the invoke-only IAM user the checklist calls for. The key belongs to a user that the Bedrock console created automatically, with AWS's `AmazonBedrockLimitedAccess` policy. Two consequences:
- Revoking the key affects both projects.
- The key can do more than invoke models.

For production, use Vercel OIDC federation with short-lived AWS credentials and a policy that allows only `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`.

**Models: Devstral until Claude access is granted.**
- Every Claude model returns `AccessDeniedException: … is not available for this account` on this AWS account, older Claude models included. It's an account-level restriction. Asim opened an AWS Support case on 2026-10-31.
- Until then, the model is `mistral.devstral-2-123b`. A plain Converse call works: it replied in 1.2 s.
- **Not verified yet: tool calling.** There is an older report of Mistral Large 2 on Bedrock refusing tool use while streaming. T4 must confirm that Devstral calls tools through the AI SDK's `streamText` before building on it.

**Choosing the model (Asim's request, built in T4).**
- `lib/agent/models.ts` becomes a registry of allowed models, with per-token prices for the spend cap.
- Each role has a default, and the chat has a model picker.
- The server accepts only IDs from the registry, never a model ID sent by the client.
- Eval runs record which model they used.
- When Claude access arrives, Claude is added as registry entries and made the default, with no code changes.

**Region.** Bedrock runs in eu-central-1, while Neon and Vercel's default function region are in the US East. That adds about 90 ms of network time per model call, which is small next to model latency.

**AWS errors (T4).** Map Bedrock errors to the app's error codes and show users a safe message. Raw AWS messages contain account and role identifiers, so they are logged on the server only.

**Local tooling.** Node 22 (`v22.23.4`) is nvm's default, and Shopify CLI 5.0.0 is installed.

## T0 checklist

| Item | Status |
|---|---|
| Shopify identity verification | Never triggered |
| Dev stores on Plus, test data off, time zone and currency set | Done, checked through the Admin API |
| Product and seeder apps installed on both stores | Done |
| Custom distribution | Not needed: the T1 pilot passed without it (left unchosen, since the choice is one-way) |
| Protected customer data at Level 1, no personal fields | Done for both apps (the seeder after the pilot's first run) |
| `read_all_orders` requested | Blocked until a distribution is chosen; deferred to spike (a) |
| Vercel project (Hobby) linked to GitHub | Done |
| Clerk development instance, roles, orgs and users | Done, checked through the Backend API |
| Neon project (free) | Done, checked with `psql` |
| Bedrock: Sonnet, Opus and Haiku 5.5 open | Blocked: account restriction, AWS case open; Devstral in use meanwhile |
| Bedrock: model IDs noted | Done |
| Invoke-only IAM user with a key | Not done: an existing Bedrock API key is reused (Asim's choice) |
| AWS Budgets alert | Skipped (Asim's choice) |
| `.env.local` with the T1 variables | Done: every required variable set; Langfuse waits for T15 |
