# 0004: T4 agent and chat

*2026-10-31. Built and tested with a scripted mock model. Not yet run against a real model: that is the first paid call (see "Not verified").*

## What exists
`lib/agent/` (checker, model registry, budget, audit, prompt, tools, the loop), `app/api/chat`, `/chat` with its components, and `npm run chat:try`. Migration `drizzle/0002_*` adds `agent_runs` and `agent_steps`.

## Rulings
- **Models are a server-side registry** (`lib/agent/models.ts`). The picker sends an app id (`devstral-2`, `claude-sonnet-5-5`, ...); a Bedrock id or anything unknown is `INVALID_INPUT`. Claude entries stay off until `BEDROCK_CLAUDE_ENABLED=true`; then the chat defaults to Sonnet 5.5, "why" to Opus 5.5 and summaries to Haiku 5.5. Until then Devstral 2 (`mistral.devstral-2-123b`, eu-central-1) is the only choice. Prices feed only the spend cap and are **estimates** (Devstral's are my assumption of $0.40 / $2.00 per million tokens; Claude's are Anthropic's own list prices, which Bedrock can differ from). Claude's reasoning effort is set low (chat) through `additionalModelRequestFields.output_config.effort`; that field is unverified on Bedrock.
- **No separate paid probe.** The plan's 15-minute spike is replaced by the first real question (`npm run chat:try`, or the chat), so nothing is spent on a test that proves less. If tool calls fail while streaming on Devstral, the registry's `streamsToolCalls` flag is where a non-streaming fallback goes.
- **The loop** (`runAgent`): budget check, then tools bound to the signed-in tenant in a closure (no schema has a tenant, shop or org field; unknown keys are rejected), at most 8 steps, `maxRetries: 1` (one retry on the same model after a timeout or 5xx), a 90-second turn timeout. The date and "data as of" go in the newest user message each turn, never in the system prompt. Only that message is edited between turns; earlier messages are replayed as they were.
- **The number checker** runs on the final answer against *this turn's* tool results only (cents become dollars, fractions become percentages, no sums or ratios are derived). If any number is unmatched, one repair turn is appended (the earlier prompt is kept byte for byte, then the answer, then the instruction) and the corrected answer is shown; anything still unmatched is flagged. The first draft streams, so the page tucks it away under "First draft" once a repair happens.
- **Browser history is untrusted.** Only the text of user and assistant messages from the last 20, cut to 4,000 characters each, reaches the model. System messages, tool results and data parts sent by the browser are dropped, and the checker's ledger never includes them, so a forged "tool result" cannot launder a number.
- **Typed errors.** A tool's `INVALID_INPUT` and `NO_DATA` go back to the model, which asks or says there is no data. Every other typed error ends the turn with that code (a disconnected store is `STORE_DISCONNECTED`). Provider errors never reach the user: a timeout, 5xx or 429 becomes `MODEL_TIMEOUT` (Retry), anything else becomes the new `INTERNAL_ERROR`; the detail goes to the server log only.
- **Spend cap.** `TENANT_DAILY_BUDGET_USD` (default 5) per brand per UTC day, counting `chat` runs only (eval runs don't count), a warning from 80%, `BUDGET_EXCEEDED` at 100%. One value for every brand; per-brand caps are later.
- **Audit log.** One `agent_runs` row per turn (model, tokens, cost in millionths of a dollar, status, error code, whether a repair was needed, numbers still flagged) and one `agent_steps` row per tool call (tool, the model's own arguments, ok, row count, latency). Prompts, answers and tool results are not stored.
- **Rendering.** Markdown is rendered from an allow-list: no images, no raw HTML (shown as inert text), links only to the app and the Shopify admin (https, exact hosts). A matched number becomes a button that opens a native popover with the tool, query id, dates, as-of time, inputs and the metric definitions. Native popovers, not shadcn/ui, because nothing needed it.
- **No Langfuse** (the build plan drops it).

## Not verified
- Anything against a real model: Devstral's tool calling (the setup note flagged an old report of tool use failing while streaming on a Mistral model), how well it follows the prompt, and answer quality.
- The `/chat` page in a browser, and the first-draft collapsing on a real repair.
- `npm run eval` does not exist yet (T5 builds the cases), so it was not run for this change to `lib/agent` and `lib/tools`.

## Known gaps
- The checker skips bare numbers from 1900 to 2100 written without a comma (read as years), and does not check money written without a `$`.
- Grouping by product returns ids, so "top products" takes a second tool call for the titles.
- Conversations are not saved; a refresh starts over.
- The first draft is visible while it streams, before the check runs.

## First live run (2026-10-31)

`npm run chat:try -- --store solenne --q "How did net sales do last month compared with the month before?"`, Devstral 2: **one tool call, streamed fine, 9,674 tokens in and 170 out, about $0.004.** The answer's figures were all correct against `truth.json` (September net sales $6,294.48; change -$2,479.22; -28.3%), so Devstral does call tools while streaming and the checker and repair loop ran for real.

Found and fixed:
- The first draft copied a raw timestamp (`2026-10-31T10:34:26.451Z`); the checker read its `31` as a claim and sent the answer back for a needless repair. ISO timestamps are now skipped (test added), and the prompt asks for dates in plain words and for falls described in words, not with a minus sign.
- `chat:try` printed the first draft and the corrected answer joined together. It now prints the last answer only.

Open question: "last month" resolves to **September**, because with the demo clock "today" is the newest order's date (2026-10-31). The product plan says October is the "last month" story (S9) and the Loom asks "How did we do last month?". Options are in the T4 hand-off; nothing has been changed yet.

## Second live check and the clock decision (2026-10-31)

On the live Tidepool chat: "Which discount codes were used most last month?" answered correctly (September: WELCOME10 2 orders, 9 with no code, out of 11, which matches the dataset) and every number was matched. The Bedrock key had been missing on Vercel; adding it fixed the earlier `INTERNAL_ERROR`.

- **The red "couldn't read" line** was a first tool call whose arguments failed schema validation (it never reached our tool code), which the model then repeated correctly. Such calls are now recorded in the audit log as `INVALID_INPUT` steps, with the model's arguments, and logged (`[agent] <tool> called with invalid input: ...`) so the cause is visible in Vercel Logs. The UI hides a failed tool line when the same tool succeeded afterwards.
- **The demo clock (ruling, Asim asked for the realistic choice):** when the newest order is more than 36 hours old, "today" is now **the day after** that order (it was the order's own day). That is what a live store looks like on the morning after its last order. Solenne's data ends on Oct 31, so on the demo "last month" is October (the S9 story and the Loom's first question) and "this month" has no orders yet (`NO_DATA`, "no November data yet"). Tidepool's data ends Oct 26, so there "today" is Oct 27 and "last month" stays September. The banner now reads "counted as if it were the day after". The plan's text ("that order's date as today") is superseded by this.

## Third live check: the 8 suggested questions on Solenne (2026-10-31)

All 8 run with `chat:try` on Devstral 2 (about $0.045 in all, estimated prices). Five answers were right first time. Four problems, all fixed:

- **A wrong number (AOV "with and without wholesale").** The model filtered to wholesale-only (`tags: ["wholesale"]`) and called that "including wholesale", so it reported $0.00. Fix: the query_metric tool description and the prompt now say that a tags filter keeps *only* those orders, and that "with and without X" is one query with no filter plus one with `excludeTags`.
- **Wrong period label.** With no period the tools use the last 30 days, but the model wrote "this month" (Q6, Q7). The prompt now says so, and tells the model to state the period from the result's `range`.
- **Cents in a table** (Q4, "75,120" for $751.20). The prompt now says dollars in tables too.
- **Two checker false positives**, each with a test first: a day range ("September 1–30", "September 1 to 30", "1–30 September"; the end must be a real day and a dash takes no spaces, so "October 31 - 83 orders" still checks 83), and a digit inside a product or variant title the tools returned ("Daily Mineral SPF 50", "30 ml"). Names are taken only from title fields, never from notes, so an injected sentence cannot excuse its own numbers.

Confirmed on a second paid run of Q1, Q4, Q6 and Q7 (about $0.033): dollars in the table, "October 2 to 31" stated, and Q7 now says the AOV is $76.26 with or without wholesale because there are no wholesale orders in the period (the wholesale order is S3, May 14). The two false positives left in that run ("30", "31" in a "to" range; "50" in "SPF 50") are what the checker changes above remove. They are covered by unit tests, not re-run live.

Not a bug, but easy to misread: Solenne's data ends on 2026-10-31 04:50 UTC, so until about 36 hours later (2026-11-01 ~17:00 UTC) the clock is real and "last month" is September. After that the demo clock applies and "last month" is October (the S9 story). Eval cases must pin the clock (`setTestNow`) so they don't depend on the day they run.

## Fourth live check: the 8 suggested questions on the Vercel URL (2026-10-31)

Signed in as the `gc_partner` reviewer (`reviewer-gc+clerk_test@example.com`, Clerk test code) in a fresh browser, brand Solenne, Devstral 2. Eight chat runs, about $0.05 in all (estimated prices); all `ok` in the audit log, role `gc_partner`. The deploy had the previous batch of fixes (the AOV answer was right).

| # | Question | Result |
|---|---|---|
| 1 | Net sales vs the month before | Correct ($6,294.48, down 28.3% from $8,773.70), all numbers checked |
| 2 | Top 5 products by units | **Numbers right, names missing**: every row said "Product" |
| 3 | Variants about to run out | Numbers checked, but raw `gid://` ids in the table and variants with 1,099 days of cover listed |
| 4 | Refund rate and top refunded products | **Rate right (3.3%), names missing** ("Product" again) |
| 5 | Discount codes last month | Correct |
| 6 | Top 5 customers by spend | Right, but the checker flagged "30" in "last 30 days" |
| 7 | AOV with and without wholesale | Correct: $76.26 both ways, no wholesale orders in the period |
| 8 | New and returning customers last month | Correct (47 new, 31 returning customers; the metric's 33 counts orders, a different definition) |

Causes and fixes:
- **Names (Q2, Q4):** a product-grouped row carried only a gid, and the model skipped the extra `search_products` call. `query_metric` rows grouped by product or variant now carry the titles under `untrusted` (tested for both stores). The prompt also says never to show a `gid://` id or a placeholder.
- **Stock (Q3):** the prompt now defines "about to run out" as no stock or 30 days of cover or less, and says to list only those.
- **"30 days" flagged (Q6):** my own prompt change told the model the default period is 30 days, and no tool input then said 30. The checker now accepts "N days" when a result's range covers N days (a count of 30 orders is still checked).

Not fixed: Q2 also added a made-up remark about a tie between 9 and 8 units. The numbers were real, so the checker passes it; only a judge-style eval would catch it (T5).
