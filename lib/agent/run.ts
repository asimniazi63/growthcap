import { APICallError, convertToModelMessages, createUIMessageStream, isStepCount, streamText, type LanguageModel, type ModelMessage, type UIMessage, type UIMessageChunk } from "ai";
import type { Db } from "../db/client";
import type { AgentSource } from "../db/schema";
import { AppError, type ErrorCode } from "../errors";
import type { TenantContext } from "../tenancy/context";
import { loadWindow, todayFor } from "../tools/common";
import { requireConnectedShop, type ToolResult } from "../tools/result";
import { beginRun, finishRun, recordStep } from "./audit";
import { assertBudget } from "./budget";
import { checkClaims, ledgerFromToolResults } from "./checker";
import { costUsd, resolveModel } from "./models";
import { repairInstruction, SYSTEM_PROMPT, turnContext } from "./prompt";
import { createModel, providerOptionsFor } from "./provider";
import { buildTools, type ToolHooks } from "./tools";

// The one agent loop, used by the chat and by the evals. It runs the tools bound to the signed-in tenant, checks every
// number in the answer against that turn's tool results, and asks the model to fix the answer once if any is unmatched.

export const MAX_STEPS = 8;
const REPAIR_STEPS = 4;
const TURN_TIMEOUT_MS = 90_000;
const MAX_MESSAGES = 20;
const MAX_TEXT_CHARS = 4000;
const STEP_LIMIT_TEXT = "I couldn't finish that within my step limit. Try a narrower question, such as one metric for one period.";

type Env = Record<string, string | undefined>;

export interface AgentInput {
  messages: UIMessage[]; // from the browser: never trusted beyond their text
  modelId?: string; // from the picker: checked against the registry
}

export interface AgentDeps {
  db?: Db;
  env?: Env;
  now?: Date;
  source?: AgentSource;
  model?: LanguageModel; // tests inject a mock
}

export interface RunSummary {
  status: "ok" | "error";
  errorCode?: ErrorCode;
  modelId: string;
  repaired: boolean;
  flaggedNumbers: number;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
}

export interface AgentStream {
  stream: ReadableStream<UIMessageChunk>;
  finished: Promise<RunSummary>;
}

export interface ProvenanceEntry {
  queryId: string;
  tool: string;
  input: unknown;
  range: { from: string; to: string };
  asOf: string;
  definitions: Record<string, string>;
  truncated?: { shown: number; total: number };
}

// Maps whatever went wrong to one of the app's error codes. The provider's own message is never passed on: it can hold
// account and role identifiers, so it stays out of what the user sees.
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const inner = (e as { lastError?: unknown } | null)?.lastError;
  if (inner) return toAppError(inner);
  if (APICallError.isInstance(e)) {
    const s = e.statusCode;
    if (s === undefined || s >= 500 || s === 429 || s === 408 || s === 409) return new AppError("MODEL_TIMEOUT", "The model did not answer in time.", { retryable: true });
  } else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return new AppError("MODEL_TIMEOUT", "The model did not answer in time.", { retryable: true });
  }
  console.error("[agent] unexpected error:", e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : String(e).slice(0, 200));
  return new AppError("INTERNAL_ERROR", "Something went wrong.");
}

// What the model sees of the browser's history: only the text of user and assistant messages, in the last few turns.
// Tool results, reasoning, data parts and system messages sent from the browser are dropped, so none of them can be
// forged into the conversation. The ledger the checker uses comes from this turn's own tool calls.
export function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  const kept = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts.filter((p) => p.type === "text").map((p) => ({ type: "text" as const, text: (p as { text: string }).text.slice(0, MAX_TEXT_CHARS) })),
    }))
    .filter((m) => m.parts.length > 0);
  if (kept.at(-1)?.role !== "user") throw new AppError("INVALID_INPUT", "The conversation must end with a question from the user.");
  return kept;
}

const withContext = (messages: UIMessage[], context: string): UIMessage[] =>
  messages.map((m, i) => (i === messages.length - 1 ? { ...m, parts: [{ type: "text" as const, text: `${context}\n\n` }, ...m.parts] } : m));

export function runAgent(ctx: TenantContext, input: AgentInput, deps: AgentDeps = {}): AgentStream {
  const summary: RunSummary = { status: "ok", modelId: "", repaired: false, flaggedNumbers: 0, steps: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 };
  let resolveFinished!: (s: RunSummary) => void;
  const finished = new Promise<RunSummary>((resolve) => (resolveFinished = resolve));

  let db: Db | undefined;
  let runId: string | null = null;
  const pending: Promise<unknown>[] = [];

  async function close(error?: AppError): Promise<void> {
    if (error) {
      summary.status = "error";
      summary.errorCode = error.code;
    }
    await Promise.allSettled(pending);
    if (db && runId) {
      await finishRun(db, runId, {
        status: summary.status,
        errorCode: summary.errorCode,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        costMicros: summary.costMicros,
        steps: summary.steps,
        repaired: summary.repaired,
        flaggedNumbers: summary.flaggedNumbers,
      }).catch(() => undefined);
    }
    resolveFinished(summary);
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      try {
        const env = deps.env ?? process.env;
        db = deps.db ?? (await import("../db/client")).getDb();
        const shop = requireConnectedShop(ctx);
        await assertBudget(ctx.tenantId, { db, now: deps.now, env });
        const spec = resolveModel(input.modelId, "chat", env);
        summary.modelId = spec.id;
        const history = sanitizeMessages(input.messages);
        runId = await beginRun(db, { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, source: deps.source ?? "chat", modelId: spec.id });

        const win = await loadWindow(db, ctx.tenantId);
        const context = turnContext({ today: todayFor(shop.timezone, win), timezone: shop.timezone, asOf: win.synced });
        const modelMessages = await convertToModelMessages(withContext(history, context));

        // What the checker and the provenance popover are built from: this turn's own tool results.
        const results: ToolResult<unknown>[] = [];
        const inputs: unknown[] = [];
        const provenance = new Map<string, ProvenanceEntry>();
        let fatal: unknown = null;
        let modelError: unknown = null;
        const dbRef = db;

        const hooks: ToolHooks = {
          onSuccess: ({ tool, input: toolInput, result, latencyMs }) => {
            results.push(result);
            inputs.push(toolInput);
            provenance.set(result.queryId, { queryId: result.queryId, tool, input: toolInput, range: result.range, asOf: result.asOf, definitions: result.definitions, ...(result.truncated ? { truncated: result.truncated } : {}) });
            pending.push(recordStep(dbRef, { runId: runId!, tenantId: ctx.tenantId, stepIndex: summary.steps++, tool, input: toolInput, ok: true, rowCount: Array.isArray(result.data) ? result.data.length : undefined, latencyMs }));
          },
          onFailure: ({ tool, input: toolInput, error, latencyMs }) => {
            pending.push(recordStep(dbRef, { runId: runId!, tenantId: ctx.tenantId, stepIndex: summary.steps++, tool, input: toolInput, ok: false, errorCode: toAppError(error).code, latencyMs }));
          },
          onFatal: (error) => {
            fatal = error;
          },
        };
        const tools = buildTools(ctx, hooks, { db });
        const model = deps.model ?? createModel(spec);
        const onError = (e: unknown) => toAppError(e).code;

        const callModel = (messages: ModelMessage[], maxSteps: number) =>
          streamText({
            model,
            system: SYSTEM_PROMPT,
            messages,
            tools,
            stopWhen: [isStepCount(maxSteps), () => fatal !== null],
            maxRetries: 1, // after a timeout or a 5xx, one retry on the same model
            timeout: { totalMs: TURN_TIMEOUT_MS },
            providerOptions: providerOptionsFor(spec),
            onError: ({ error }) => {
              modelError ??= error;
            },
            // A call whose arguments fail validation never reaches our tool code, so it is recorded here. The model sees
            // the validation error and usually tries again, as it did on the live site.
            onStepFinish: (step) => {
              for (const part of step.content) {
                if (part.type !== "tool-call" || !("invalid" in part) || !part.invalid) continue;
                const detail = (part as { error?: { message?: string } }).error?.message ?? "";
                console.warn(`[agent] ${part.toolName} called with invalid input: ${detail.slice(0, 300)}`);
                pending.push(recordStep(dbRef, { runId: runId!, tenantId: ctx.tenantId, stepIndex: summary.steps++, tool: part.toolName, input: part.input, ok: false, errorCode: "INVALID_INPUT", latencyMs: 0 }));
              }
            },
          });

        // Settles a model call: its steps, usage and what it added to the conversation, or the error that ended it.
        const settle = async (r: ReturnType<typeof callModel>) => {
          try {
            const [steps, usage] = await Promise.all([r.steps, r.totalUsage]);
            summary.inputTokens += usage.inputTokens ?? 0;
            summary.outputTokens += usage.outputTokens ?? 0;
            // Each step's response holds only that step's messages (the tool call and its result, or the answer), so the
            // conversation this call produced is all of them in order.
            return { steps, produced: steps.flatMap((s) => s.response.messages) };
          } catch (e) {
            modelError ??= e;
            return null;
          }
        };

        const verify = (answer: string, attempt: number) => {
          const check = checkClaims(answer, ledgerFromToolResults(results), inputs);
          writer.write({ type: "data-verification", data: { attempt, ok: check.ok, unmatched: check.unmatched, matched: check.matched } });
          return check;
        };

        const first = callModel(modelMessages, MAX_STEPS);
        writer.merge(first.toUIMessageStream({ sendFinish: false, onError }));
        const one = await settle(first);
        if (modelError) throw toAppError(modelError);
        if (fatal) throw fatal;

        let answer = one?.steps.at(-1)?.text ?? "";
        const hitCap = !answer || (one?.steps.at(-1)?.toolCalls.length ?? 0) > 0;
        let check = hitCap ? null : verify(answer, 1);
        if (hitCap) {
          writer.write({ type: "text-start", id: "step-limit" });
          writer.write({ type: "text-delta", id: "step-limit", delta: STEP_LIMIT_TEXT });
          writer.write({ type: "text-end", id: "step-limit" });
        }

        if (check && !check.ok && one) {
          summary.repaired = true;
          writer.write({ type: "data-repair", data: { unmatched: check.unmatched.map((u) => u.text) } });
          const second = callModel([...modelMessages, ...one.produced, { role: "user", content: repairInstruction(check.unmatched.map((u) => u.text)) }], REPAIR_STEPS);
          writer.merge(second.toUIMessageStream({ sendStart: false, sendFinish: false, onError }));
          const two = await settle(second);
          if (modelError) throw toAppError(modelError);
          if (fatal) throw fatal;
          answer = two?.steps.at(-1)?.text ?? "";
          if (answer) check = verify(answer, 2);
        }
        summary.flaggedNumbers = check && !check.ok ? check.unmatched.length : 0;

        writer.write({ type: "data-provenance", data: [...provenance.values()] });
        writer.write({ type: "finish" });
        summary.costMicros = Math.round(costUsd(spec, summary) * 1e6);
        await close();
      } catch (e) {
        const error = toAppError(e);
        if (db && summary.modelId) summary.costMicros = Math.round(costUsd(resolveModel(summary.modelId, "chat", deps.env ?? process.env), summary) * 1e6);
        await close(error);
        throw error;
      }
    },
    onError: (e) => toAppError(e).code,
  });

  return { stream, finished };
}
