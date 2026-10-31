import { APICallError, convertToModelMessages, createUIMessageStream, isStepCount, streamText, type LanguageModel, type ModelMessage, type UIMessage, type UIMessageChunk } from "ai";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { tenants, type AgentSource } from "../db/schema";
import { AppError, type ErrorCode } from "../errors";
import { confirmedNotes } from "../memory/store";
import type { TenantContext } from "../tenancy/context";
import { loadWindow, todayFor } from "../tools/common";
import { requireConnectedShop, type ToolResult } from "../tools/result";
import { beginRun, finishRun, recordStep } from "./audit";
import { assertBudget } from "./budget";
import { checkClaims, ledgerFromToolResults } from "./checker";
import { fallbackReason, shouldFallback } from "./fallback";
import { costUsd, fallbackModelFor, resolveModel, type ModelSpec } from "./models";
import { repairInstruction, SYSTEM_PROMPT, turnContext } from "./prompt";
import { createModel, providerOptionsFor } from "./provider";
import { telemetryFor, withTrace } from "../ops/tracing";
import { buildExtraTools, trackedCalls } from "./extra-tools";
import { buildTools, type ToolHooks } from "./tools";
import { buildRememberTool, buildRenderViewTool, type TurnCall } from "./view-tools";

// The one agent loop, used by the chat and by the evals. It runs the tools bound to the signed-in tenant, checks every
// number in the answer against that turn's tool results, and asks the model to fix the answer once if any is unmatched.

export const MAX_STEPS = 8;
const REPAIR_STEPS = 4;
const TURN_TIMEOUT_MS = 90_000;
const FALLBACK_MIN_MS = 15_000; // a fallback attempt gets what is left of the route's 120 s, but at least this long
const ROUTE_BUDGET_MS = 115_000;
const MAX_MESSAGES = 20;
const MAX_TEXT_CHARS = 4000;
const STEP_LIMIT_TEXT = "I couldn't finish that within my step limit. Try a narrower question, such as one metric for one period.";

type Env = Record<string, string | undefined>;

// A saved conversation. Its history is what the provider returned, replayed as stored; the browser's earlier messages are
// not used at all, only the newest question.
export interface ThreadInput {
  id: string;
  title: string;
  history: ModelMessage[];
  ui: UIMessage[]; // the display copy so far
}

export interface AgentInput {
  messages: UIMessage[]; // from the browser: never trusted beyond their text
  modelId?: string; // from the picker: checked against the registry
  thread?: ThreadInput;
}

export interface TurnSaved {
  threadId: string;
  title: string;
  delta: ModelMessage[]; // what the model exchanged this turn, exactly as sent and returned
  ui: UIMessage[]; // the whole display copy, built from the stream the server sent
  summary: RunSummary;
}

export interface AgentDeps {
  db?: Db;
  env?: Env;
  now?: Date;
  source?: AgentSource;
  model?: LanguageModel; // tests inject a mock
  fallbackModel?: LanguageModel; // tests inject a mock; with `model` injected and no fallback given, a failed turn is not retried elsewhere
  onTurn?: (turn: TurnSaved) => Promise<void>; // called after a thread's turn finished without an error
}

export interface RunSummary {
  status: "ok" | "error";
  errorCode?: ErrorCode;
  modelId: string; // the model that answered: the fallback's id after a fallback
  fallback?: { from: string; to: string; reason: string }; // set when the turn moved to the fallback model
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
  let primary: ModelSpec | undefined; // the model the turn started on
  let fallbackAdjustUsd = 0; // what the fallback model's own tokens cost beyond the primary's prices
  // Both attempts count: the tokens of every attempt are in the summary, priced at the model that spent them.
  const spendMicros = () => (primary ? Math.round((costUsd(primary, summary) + fallbackAdjustUsd) * 1e6) : 0);

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
        ...(summary.fallback ? { modelId: summary.modelId } : {}), // the audit row names the model that answered
      }).catch(() => undefined);
    }
    resolveFinished(summary);
  }

  // The display copy of a saved thread is built from this turn's own stream, starting from what was saved plus the newest
  // question (text only). If that question can't be read, execute fails with the same error below.
  let userUi: UIMessage | null = null;
  if (input.thread) {
    try {
      userUi = sanitizeMessages(input.messages.slice(-1))[0] ?? null;
    } catch {
      userUi = null;
    }
  }
  let delta: ModelMessage[] = [];

  const stream = createUIMessageStream({
    ...(input.thread && userUi
      ? {
          originalMessages: [...input.thread.ui, userUi],
          onEnd: async ({ messages }: { messages: UIMessage[] }) => {
            if (summary.status !== "ok" || !deps.onTurn) return;
            try {
              await deps.onTurn({ threadId: input.thread!.id, title: input.thread!.title, delta, ui: messages, summary });
            } catch (e) {
              console.error("[agent] could not save the thread:", e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200));
            }
          },
        }
      : {}),
    execute: async ({ writer }) => {
      try {
        const env = deps.env ?? process.env;
        db = deps.db ?? (await import("../db/client")).getDb();
        const shop = requireConnectedShop(ctx);
        await assertBudget(ctx.tenantId, { db, now: deps.now, env });
        const spec = resolveModel(input.modelId, "chat", env);
        primary = spec;
        summary.modelId = spec.id;
        const history = sanitizeMessages(input.thread ? input.messages.slice(-1) : input.messages);
        runId = await beginRun(db, { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role, source: deps.source ?? "chat", modelId: spec.id });

        const win = await loadWindow(db, ctx.tenantId);
        const notes = await confirmedNotes(db, ctx.tenantId).catch(() => [] as string[]);
        const [brandRow] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
        const context = turnContext({ today: todayFor(shop.timezone, win), timezone: shop.timezone, asOf: win.synced, notes, brand: brandRow?.name });
        let userMessage: ModelMessage | null = null; // what is saved for this question: the text without the per-turn context
        let modelMessages: ModelMessage[];
        if (input.thread) {
          // Replayed as stored; only the newest question is new, with this turn's context in front of it.
          const text = history.at(-1)!.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
          // The context (today's date, the confirmed notes) goes to the model with this question but is not saved with it, so a
          // later turn doesn't replay a date that has rolled over or a note that has since been removed.
          userMessage = { role: "user", content: [{ type: "text", text }] };
          modelMessages = [...input.thread.history, { role: "user", content: [{ type: "text", text: `${context}\n\n` }, { type: "text", text }] }];
          writer.write({ type: "data-thread", data: { id: input.thread.id, title: input.thread.title } });
        } else {
          modelMessages = await convertToModelMessages(withContext(history, context));
        }

        // What the checker and the provenance popover are built from: this turn's own tool results.
        const results: ToolResult<unknown>[] = [];
        const inputs: unknown[] = [];
        const provenance = new Map<string, ProvenanceEntry>();
        const calls = new Map<string, TurnCall>();
        let fatal: unknown = null;
        let modelError: unknown = null;
        const dbRef = db;

        const hooks: ToolHooks = {
          onSuccess: ({ tool, input: toolInput, result, latencyMs }) => {
            results.push(result);
            inputs.push(toolInput);
            calls.set(result.queryId, { tool, input: toolInput, result });
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
        const step = (e: { tool: string; input: unknown; ok: boolean; errorCode?: string; latencyMs: number }) =>
          pending.push(recordStep(dbRef, { runId: runId!, tenantId: ctx.tenantId, stepIndex: summary.steps++, tool: e.tool, input: e.input, ok: e.ok, errorCode: e.errorCode, latencyMs: e.latencyMs }));
        const write = (chunk: UIMessageChunk) => writer.write(chunk);
        const model = deps.model ?? createModel(spec);
        // The fallback exists unless a test injected a model and no fallback: that must never reach the real provider.
        const fbSpec = deps.model && !deps.fallbackModel ? null : fallbackModelFor(spec, env);
        const route = deps.source ?? "chat";
        const extra = buildExtraTools({
          ctx,
          db,
          model,
          now: deps.now ?? new Date(),
          write,
          onStep: step,
          calls: trackedCalls(calls, (queryId, call, isNew) => {
            // explain_gap runs sub-agents on its own: their tokens count toward this turn's cost and the brand's daily cap,
            // every time it runs (a second call with the same query id still spent them).
            const used = (call.result as { meta?: { usage?: { total?: { inputTokens?: number; outputTokens?: number } } } }).meta?.usage?.total;
            summary.inputTokens += used?.inputTokens ?? 0;
            summary.outputTokens += used?.outputTokens ?? 0;
            if (!isNew) return;
            // A result from a stretch tool: the number checker and the provenance popover read it like any other.
            results.push(call.result);
            inputs.push(call.input);
            provenance.set(queryId, { queryId, tool: call.tool, input: call.input, range: call.result.range, asOf: call.result.asOf, definitions: call.result.definitions, ...(call.result.truncated ? { truncated: call.result.truncated } : {}) });
          }),
        }, { singleAgent: env.AGENT_SINGLE_AGENT === "true" });
        const tools = {
          ...buildTools(ctx, hooks, { db }),
          ...extra,
          render_view: buildRenderViewTool({ calls, write, onStep: step, titleProblems: (title) => checkClaims(title, ledgerFromToolResults(results), inputs).unmatched.map((u) => u.text) }),
          // Notes can be confirmed only by a Growth Capital admin or partner, so a client viewer is not offered the tool.
          ...(ctx.role !== "client_viewer" ? { remember: buildRememberTool({ ctx, db, write, onStep: step }) } : {}),
        };
        // The model answering now, and what the current attempt has done (for the fallback decision).
        let active: { spec: ModelSpec; model: LanguageModel } = { spec, model };
        let fellBack = false;
        let textStreamed = false; // answer text of the current attempt has reached the browser
        let attemptError: unknown; // the raw error the current attempt's stream reported
        let attemptMessages: ModelMessage[] = []; // what the current attempt's finished steps added to the conversation
        let attemptSteps = 0;
        let attemptIn = 0;
        let attemptOut = 0;
        const turnStart = Date.now();
        const toolNames = Object.keys(tools);

        const callModel = (messages: ModelMessage[], maxSteps: number, timeoutMs = TURN_TIMEOUT_MS) =>
          withTrace({ tenantId: ctx.tenantId, route, modelId: active.spec.id, toolNames }, () => streamText({
            model: active.model,
            system: SYSTEM_PROMPT,
            messages,
            tools,
            stopWhen: [isStepCount(maxSteps), () => fatal !== null],
            maxRetries: 1, // after a timeout or a 5xx, one retry on the same model
            timeout: { totalMs: timeoutMs },
            providerOptions: providerOptionsFor(active.spec),
            telemetry: telemetryFor({ tenantId: ctx.tenantId, route, modelId: active.spec.id, toolNames }),
            onError: ({ error }) => {
              modelError ??= error;
            },
            // A call whose arguments fail validation never reaches our tool code, so it is recorded here. The model sees
            // the validation error and usually tries again, as it did on the live site.
            onStepFinish: (step) => {
              attemptMessages.push(...step.response.messages);
              attemptSteps++;
              attemptIn += step.usage?.inputTokens ?? 0;
              attemptOut += step.usage?.outputTokens ?? 0;
              for (const part of step.content) {
                if (part.type !== "tool-call" || !("invalid" in part) || !part.invalid) continue;
                const detail = (part as { error?: { message?: string } }).error?.message ?? "";
                console.warn(`[agent] ${part.toolName} called with invalid input: ${detail.slice(0, 300)}`);
                pending.push(recordStep(dbRef, { runId: runId!, tenantId: ctx.tenantId, stepIndex: summary.steps++, tool: part.toolName, input: part.input, ok: false, errorCode: "INVALID_INPUT", latencyMs: 0 }));
              }
            },
          }));

        // Settles a model call: its steps, usage and what it added to the conversation, or the error that ended it.
        // The tokens an attempt spent are priced at the model that spent them: a fallback attempt's difference from the
        // primary's prices is kept apart, and added to the cost at the end.
        const spent = (inputTokens: number, outputTokens: number) => {
          summary.inputTokens += inputTokens;
          summary.outputTokens += outputTokens;
          if (active.spec.id !== spec.id) fallbackAdjustUsd += costUsd(active.spec, { inputTokens, outputTokens }) - costUsd(spec, { inputTokens, outputTokens });
        };
        const settle = async (r: ReturnType<typeof callModel>) => {
          try {
            const [steps, usage] = await Promise.all([r.steps, r.totalUsage]);
            spent(usage.inputTokens ?? 0, usage.outputTokens ?? 0);
            // Each step's response holds only that step's messages (the tool call and its result, or the answer), so the
            // conversation this call produced is all of them in order.
            return { steps, produced: steps.flatMap((s) => s.response.messages) };
          } catch (e) {
            modelError ??= e;
            spent(attemptIn, attemptOut); // a failed call still used what its finished steps cost
            return null;
          }
        };

        // Moving to the fallback model is allowed once per turn, only for a timeout, a 5xx or an unavailable provider, and
        // only while no answer text of this attempt has reached the browser. Budget, validation and tool errors never qualify.
        let startSent = false;
        const canFallBack = (e: unknown) => !fellBack && fbSpec !== null && !textStreamed && fatal === null && e !== undefined && shouldFallback(e);
        const onModelError = (e: unknown) => {
          attemptError ??= e;
          return toAppError(e).code;
        };
        // Watches the attempt's stream. The error chunk of an attempt that is about to move to the fallback is held back,
        // so the browser sees one answer and no error.
        const watch = (source: ReadableStream<UIMessageChunk>) =>
          source.pipeThrough(
            new TransformStream<UIMessageChunk, UIMessageChunk>({
              transform(chunk, controller) {
                if (chunk.type === "start") startSent = true;
                if (chunk.type === "text-delta" && chunk.delta) textStreamed = true;
                if (chunk.type === "error" && canFallBack(attemptError)) return;
                controller.enqueue(chunk);
              },
            }),
          );
        const resetAttempt = () => {
          textStreamed = false;
          attemptError = undefined;
          attemptMessages = [];
          attemptSteps = 0;
          attemptIn = 0;
          attemptOut = 0;
          modelError = null;
        };

        // One model call, merged into the stream. If it fails in a way the fallback can help with, the turn moves once to the
        // fallback model and carries on from the steps that had finished (their tools are not run again).
        const runModel = async (messages: ModelMessage[], maxSteps: number, sendStart: boolean) => {
          resetAttempt();
          const call = callModel(messages, maxSteps);
          writer.merge(watch(call.toUIMessageStream({ sendStart: sendStart && !startSent, sendFinish: false, onError: onModelError })));
          const done = await settle(call);
          if (!modelError) return done;
          if (!canFallBack(modelError)) throw toAppError(modelError);

          const carried = attemptMessages;
          const stepsDone = attemptSteps;
          const to = fbSpec!;
          const reason = fallbackReason(modelError);
          console.warn(`[agent] ${active.spec.id} failed (${reason}); the turn moves to ${to.id}`);
          fellBack = true;
          summary.fallback = { from: active.spec.id, to: to.id, reason };
          step({ tool: "model_fallback", input: { from: active.spec.id, to: to.id, reason }, ok: true, latencyMs: Date.now() - turnStart });
          active = { spec: to, model: deps.fallbackModel ?? createModel(to) };
          summary.modelId = to.id;
          resetAttempt();
          const timeoutMs = Math.max(FALLBACK_MIN_MS, Math.min(TURN_TIMEOUT_MS, ROUTE_BUDGET_MS - (Date.now() - turnStart)));
          const again = callModel([...messages, ...carried], Math.max(1, maxSteps - stepsDone), timeoutMs);
          writer.merge(watch(again.toUIMessageStream({ sendStart: !startSent, sendFinish: false, onError: onModelError })));
          const result = await settle(again);
          if (modelError) throw toAppError(modelError);
          return result && { steps: result.steps, produced: [...carried, ...result.produced] };
        };

        const verify = (answer: string, attempt: number) => {
          const check = checkClaims(answer, ledgerFromToolResults(results), inputs);
          writer.write({ type: "data-verification", data: { attempt, ok: check.ok, unmatched: check.unmatched, matched: check.matched } });
          return check;
        };

        const one = await runModel(modelMessages, MAX_STEPS, true);
        if (fatal) throw fatal;
        delta = [...(userMessage ? [userMessage] : []), ...(one?.produced ?? [])];

        let answer = one?.steps.at(-1)?.text ?? "";
        const hitCap = !answer || (one?.steps.at(-1)?.toolCalls.length ?? 0) > 0;
        let check = hitCap ? null : verify(answer, 1);
        if (hitCap) {
          writer.write({ type: "text-start", id: "step-limit" });
          writer.write({ type: "text-delta", id: "step-limit", delta: STEP_LIMIT_TEXT });
          writer.write({ type: "text-end", id: "step-limit" });
          delta.push({ role: "assistant", content: [{ type: "text", text: STEP_LIMIT_TEXT }] }); // keeps the saved history well formed
        }

        if (check && !check.ok && one) {
          summary.repaired = true;
          writer.write({ type: "data-repair", data: { unmatched: check.unmatched.map((u) => u.text) } });
          const repairMessage: ModelMessage = { role: "user", content: repairInstruction(check.unmatched.map((u) => u.text)) };
          const two = await runModel([...modelMessages, ...one.produced, repairMessage], REPAIR_STEPS, false);
          if (fatal) throw fatal;
          delta.push(repairMessage, ...(two?.produced ?? []));
          answer = two?.steps.at(-1)?.text ?? "";
          if (answer) check = verify(answer, 2);
        }
        summary.flaggedNumbers = check && !check.ok ? check.unmatched.length : 0;

        writer.write({ type: "data-provenance", data: [...provenance.values()] });
        writer.write({ type: "finish" });
        summary.costMicros = spendMicros();
        await close();
      } catch (e) {
        const error = toAppError(e);
        if (db) summary.costMicros = spendMicros();
        await close(error);
        throw error;
      }
    },
    onError: (e) => toAppError(e).code,
  });

  return { stream, finished };
}
