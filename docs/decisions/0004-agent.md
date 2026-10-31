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
