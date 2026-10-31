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

## Live checks and reviews (2026-10-31)

Run on the live site against Solenne with Devstral 2. Plan in read the SOW correctly (the three monthly net sales targets with
their pages; the refund rate, the quarter total and the Black Friday goal came back as "not applied"). A Metric Target was approved and
written to the store. A landing page was drafted, approved, refused by Shopify (the exemption), recorded as failed with the reason, and
finished with `npm run landing:push`. The portfolio and the weekly brief (cron, approval, log delivery) worked. Why answers a
finished month and refuses an unfinished one.

Three independent reviews (ledger and landing pages; plan in, briefs and portfolio; Why and the agent wiring) found 30 issues. Fixed:
writes retried after a 5xx; actions stuck in running; an unwritten landing page recorded as done; a typed price passing the lint
("29USD", full-width digits); the cron brief running with write tools; a reviewer's brief approval changing real state; plan in's
PDF page count, row cap, repeat reads, budget and quote display; investigators answering with their tool results stripped on Bedrock;
a figure in a calendar title excusing itself in the checker; explain_gap spend not counted on a repeat call. Known and left: the
payload hash proves a payload did not change in the database but is not a signature; two landing pages with the same slug overwrite
each other; annotation dates for stores at UTC+12 or more; a Shopify target is "Total sales" (with tax and shipping), not net sales;
the portfolio assumes one currency.

Eval finding: on Devstral the free-form "why" answers were unreliable because the investigators chose the wrong tools. The evidence is
now gathered in code and the model only interprets it.

## Open until the final ship

Claude on Bedrock (the evals ran on Devstral), the exemption for theme writes, Slack and MCP.
