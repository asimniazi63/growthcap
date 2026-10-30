# Feature map

Every feature we considered for the take-home, sorted under the item of the original brief it serves. Ideas that don't fit a brief item go under the brief's last line, "add as many additional features as you would like."

**Tiers:** Core = required for a valid submission. Polish = after core works. Stretch = only if time remains. Beyond = roadmap ideas past the stretch list. Ranked lower = considered and set aside. ⭐ = top 3 picks beyond the checklist.

**#** is the feature's number in the full feature list. A number appears twice when one feature serves two asks.

| Original ask | # | Feature | Tier | What it involves |
|---|---|---|---|---|
| **Req 1: Test Shopify app** | 1 | App created, installable | Core | Dev Dashboard app, `shopify.app.toml` in repo (`embedded = false`), custom distribution |
| | 6 | Secure auth + live data | Core | Clerk login + orgs, Shopify OAuth, encrypted offline token in Neon, read-only scopes, HMAC-checked webhooks, server-side calls only |
| | 4 | Separate seeder app | Core | Write-scoped app using client credentials (24-hour token), only for loading data |
| | 43 | Production token handling | Beyond | Public unlisted app, expiring tokens (60 min / 90 days), refresh service with locking |
| **Req 2: Test dev store** | 2 | Real dev store | Core | Created online in the Dev Dashboard, Plus plan, no generated test data |
| | 3 | Realistic seeded data | Core | Fictional skincare brand, Sep 2025 → Oct 2026: ~30 products, ~2,000 customers, ~3,000 orders, discounts, refunds, unit costs |
| | 4 | Generator + seeder | Core | Deterministic TS generator ("truth" JSON), resumable loader at 5 orders/min (overnight), backdated orders, check against ShopifyQL |
| | 5 | Hidden storylines | Core | Price increase, shipping threshold, wholesale order, bad batch, viral shade, leaked code, stockout, weak BFCM cohort, prompt injection |
| | — | Permission setup | Core | `read_reports` + Level 2 customer data (ShopifyQL), `read_all_orders` (orders older than 60 days) |
| **Req 3: AI agent that queries data on demand** | 7 | Agent | Core | Next.js + Vercel AI SDK + Claude, streaming, asks when unclear, honest when data is missing |
| | 8 | Read-only tools | Core | `search_products`, `get_orders`, `get_sales_summary`, `get_customers`, `get_inventory` |
| | 9 | Chat UI | Core | Loading message per tool. Errors for rate limit, disconnected store, AI timeout, no results |
| | 12 | Suggested questions | Polish | In GC's language |
| | 13 | Structured answers + receipts | Polish | Tables, plus the query, definition and rows behind each answer |
| | 14 | Date filters + limits | Polish | Store timezone, default last 30 days, row caps |
| | 15 | Logging + input validation | Polish | Schema-checked tool inputs, every call logged, Langfuse traces |
| | 17 | Metric definitions | Polish | METRICS.md + in-app definitions |
| | 18 | Number grounding check | Polish | Every number must come from a tool result |
| | 19 | Prompt-injection defense | Polish | Store text treated as data, tested with the planted order note |
| | 20 | Reliability basics | Polish | Rate-limit handling, pinned API version, AI timeouts + fallback, spend caps |
| | 16 | Tests | Polish | Unit tests (math, inputs, mocked Shopify errors) + ~20 golden questions |
| | 22 | History + memory | Stretch | Saved threads, `remember` tool for per-store facts and targets |
| | 26 | Multi-agent | Stretch | Parallel "why" investigators + checker agent, measured against single agent |
| | 27 | Write operations | Stretch | Discounts, segments, product costs, with approval + audit log |
| | 42 | Warehouse + metric layer | Beyond | Bulk export → Postgres, webhooks, nightly reconciliation, metrics as code |
| **Stretch 1: Generative UI & dashboarding** | 21 | Generative UI | Stretch | KPI cards, charts, cohort grids. Pinned dashboards stay live |
| | 28 | KPI pacing + reforecast | Beyond ⭐ | Monthly targets, "92% of pace, need $X/day" |
| | 37 | Portfolio mode | Beyond | All client stores in one view, anonymized benchmarks |
| **Stretch 2: Document parsing** | 23 | Invoice → product costs + doc Q&A | Stretch | Supplier invoice PDF → unit costs → proposed update, plus questions over the document |
| | 41 | Call transcripts → client context | Beyond | Client calls update plans and action items |
| **Stretch 3: Shopify Liquid page generation** | 24 | Landing page generator | Stretch | Black Friday page for top gift products, pushed to an unpublished theme. Needs theme-write exemption, with a CLI + Theme Access fallback |
| | 46 | Creative-to-commerce loop | Ranked lower | Ad briefs → static ads → matching landing pages |
| **Stretch 4: Additional data sources** | 25 | Ad-platform data | Stretch | Meta/Google/TikTok spend → MER, CAC, contribution margin, payback |
| **Delivery: GitHub repo + Loom** | 10 | README + setup | Core | Step-by-step setup, known limitations |
| | 11 | Loom | Core | End-to-end flow. Rough "insurance" Loom once core is deployed |
| | 44 | Evals in CI | Beyond | Golden set, storyline discovery rate, cost/latency scoreboard |
| | 45 | Docs for the role | Beyond | Architecture diagram + ADRs, ROADMAP.md, SLOs, runbooks |
| **"Add as many additional features as you would like"** | 29 | Monday briefing | Beyond ⭐ | What changed and why, posted to Slack (Liam's job) |
| | 30 | Instant growth audit | Beyond ⭐ | Prospect connects store → 10-minute audit + top 3 opportunities |
| | 31 | Black Friday war room | Beyond | Demand forecast, stockout risk, what-if P&L |
| | 32 | Forecast + scenario planner | Beyond | What-ifs for discount, shipping threshold, price |
| | 33 | Inventory runway | Beyond | Days of stock left, reorder points |
| | 34 | Promo post-mortems | Beyond | True extra sales vs. pulled forward, cohort quality by offer |
| | 35 | Retention segments | Beyond | Customer value (RFM) / LTV / churn segments → Shopify → Klaviyo, replenishment nudges |
| | 36 | Merchandising intelligence | Beyond | Bundles from baskets, launch curves |
| | 38 | Playbooks as agent skills | Beyond | BFCM review, retention check, monthly business review |
| | 39 | Use it anywhere | Beyond | Slack bot, MCP server, Sidekick extension |
| | 40 | Data-health monitor | Beyond | Tracking gaps, missing costs, skewing orders, sync lag |
| | 47 | AI-shopping readiness audit | Ranked lower | How well the catalog shows up in ChatGPT and Gemini shopping |
