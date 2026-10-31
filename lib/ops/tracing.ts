import { OpenTelemetry } from "@ai-sdk/otel";
import { registerTelemetry } from "ai";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { propagateAttributes } from "@langfuse/tracing";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

// Langfuse tracing for the agent, through the AI SDK's telemetry hook and Langfuse's OpenTelemetry span processor.
//
// What a trace holds: the tenant id (as the Langfuse user), the route (chat, brief, audit, eval), the model id, the tool
// names, timings and token counts. What it never holds: prompts, answers, tool arguments or tool results (recordInputs and
// recordOutputs are off on every call). It is fully inert unless all three LANGFUSE_* variables are set: no provider, no
// network, and telemetryFor() switches telemetry off for the call.

export type TraceRoute = "chat" | "brief" | "audit" | "eval";
type Env = Record<string, string | undefined>;

export interface TraceInput {
  tenantId: string;
  route: TraceRoute | string;
  modelId: string;
  toolNames?: string[];
}

// Next.js bundles instrumentation.ts and the route handlers separately, so the processor lives on globalThis.
const KEY = Symbol.for("oasis.langfuse.processor");
const slot = globalThis as unknown as Record<symbol, LangfuseSpanProcessor | undefined>;

export const tracingConfigured = (env: Env = process.env): boolean => Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY && env.LANGFUSE_BASE_URL);
export const tracingActive = (): boolean => slot[KEY] !== undefined;

// Called once from instrumentation.ts (and by the evals). Does nothing when Langfuse is not configured or already started.
export function startTracing(env: Env = process.env): boolean {
  if (slot[KEY]) return true;
  if (!tracingConfigured(env)) return false;
  try {
    const processor = new LangfuseSpanProcessor({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_BASE_URL,
      environment: env.VERCEL_ENV ?? env.NODE_ENV ?? "development",
      mediaUploadEnabled: false,
    });
    new NodeTracerProvider({ spanProcessors: [processor] }).register();
    registerTelemetry(new OpenTelemetry());
    slot[KEY] = processor;
    return true;
  } catch (e) {
    console.error("[tracing] could not start Langfuse tracing:", e instanceof Error ? e.message.slice(0, 200) : "unknown error");
    return false;
  }
}

// The `telemetry` option for streamText/generateText. Inputs and outputs are never recorded.
export function telemetryFor(input: TraceInput): { isEnabled: boolean; recordInputs: false; recordOutputs: false; functionId: string } {
  return { isEnabled: tracingActive(), recordInputs: false, recordOutputs: false, functionId: `oasis-pace.${input.route}` };
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

// The labels on every span of one call. Tool names are the tools on offer; the tools actually run are the execute_tool spans.
export function traceAttributes(input: TraceInput) {
  return {
    userId: clip(input.tenantId, 190),
    traceName: `oasis-pace.${input.route}`,
    tags: [`tenant:${input.tenantId}`, `route:${input.route}`, `model:${input.modelId}`].map((t) => clip(t, 190)),
    metadata: { tenant_id: input.tenantId, route: String(input.route), model_id: input.modelId, ...(input.toolNames?.length ? { tools: clip(input.toolNames.join(","), 150) } : {}) },
  };
}

// Runs `fn` (the call that starts the model) with the labels attached to every span it creates. A plain call when inert.
export function withTrace<T>(input: TraceInput, fn: () => T): T {
  if (!tracingActive()) return fn();
  try {
    return propagateAttributes(traceAttributes(input), fn);
  } catch {
    return fn();
  }
}

// Sends what is buffered. Call it in Next's `after()` where a route handler runs the agent, so a serverless function
// does not freeze before the spans leave. Never throws.
export async function flushTraces(): Promise<void> {
  const processor = slot[KEY];
  if (!processor) return;
  try {
    await processor.forceFlush();
  } catch {
    /* tracing must never break a request */
  }
}
