# 0006: The stretch build (T7 to T10), 2026-10-31

Built in one parallel pass by six workers on disjoint files, over one shared migration (`0005`) and four shared contracts
(`lib/actions/types.ts`, `lib/why/types.ts`, `lib/agent/extra-types.ts`, `lib/actions/reviewer.ts`). The lead alone edited the
shared files (`run.ts`, `prompt.ts`, `schema.ts`, `shopify.app.toml`, `next.config.ts`).

## Choices worth knowing

- **The model never writes Liquid or Shopify mutations.** `draft_landing_page` takes copy only; the server builds the page from
  fixed templates, and prices and stock are Liquid objects (`| money`). `propose_action` takes typed fields; the server builds
  the GraphQL, with user text only in variables.
- **One ledger for every write.** `actions` stores the exact payload and its hash. Approval re-validates both, then moves
  proposed to running in one conditional update, so a double click runs once. A reviewer login's approval is a dry run: the card
  shows the mutations, and nothing is sent.
- **Authority.** Proposing, approving and rejecting need `gc_admin` or `gc_partner`. The model's tools hold no tenant, shop or
  user field. The brief cron's authority is the `CRON_SECRET` check, and a brief is never delivered without an approval.
- **Why is checked twice.** `driverTree` is deterministic (midpoint split, remainder on the largest part so the sum is exact).
  Each investigator's figures must be found in its own tool results, or its finding is dropped. A figure that appears only in a
  call note cannot be repeated, because the number checker only accepts tool results.
- **Plan in reads text, not the PDF.** Pass 1 lists each target with a verbatim quote and page; a quote that is not on that page
  is dropped. Pass 2 builds structured targets from the sentences alone. Targets the monthly plan cannot hold (refund rate, a
  quarter total, a weekend goal) are listed as "not applied", never dropped silently.
- **Deferred:** Slack posting, MCP, the Theme Access fallback for theme writes, a single-vs-multi-agent comparison table.

## Open until T11

Live checks for every piece, the why/plan-in/landing evals, `shopify app deploy` and the scope approvals in both stores, and a
Theme Check run on the deployed route (it reads bundled docs and tries one network fetch).
