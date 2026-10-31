import { describe, expect, it } from "vitest";
import { flushTraces, startTracing, telemetryFor, tracingActive, tracingConfigured, traceAttributes, withTrace } from "./tracing";

const input = { tenantId: "11111111-1111-1111-1111-111111111111", route: "chat", modelId: "claude-sonnet-4-6", toolNames: ["query_metric", "pace"] };

describe("tracing when Langfuse is not configured", () => {
  it("is inert: nothing starts, telemetry is off, labels do nothing, flushing is a no-op", async () => {
    expect(tracingConfigured({})).toBe(false);
    expect(tracingConfigured({ LANGFUSE_PUBLIC_KEY: "a", LANGFUSE_SECRET_KEY: "b" })).toBe(false);
    expect(startTracing({})).toBe(false);
    expect(tracingActive()).toBe(false);
    expect(telemetryFor(input)).toMatchObject({ isEnabled: false, recordInputs: false, recordOutputs: false });
    expect(withTrace(input, () => 42)).toBe(42);
    await expect(flushTraces()).resolves.toBeUndefined();
  });
});

describe("what a trace is labelled with", () => {
  it("has the tenant, route, model and tools, and nothing from a prompt or an answer", () => {
    const a = traceAttributes(input);
    expect(a.userId).toBe(input.tenantId);
    expect(a.tags).toEqual([`tenant:${input.tenantId}`, "route:chat", "model:claude-sonnet-4-6"]);
    expect(a.metadata).toEqual({ tenant_id: input.tenantId, route: "chat", model_id: "claude-sonnet-4-6", tools: "query_metric,pace" });
    expect(telemetryFor(input).recordInputs).toBe(false);
    expect(telemetryFor(input).recordOutputs).toBe(false);
  });
  it("keeps long tool lists inside Langfuse's limits", () => {
    const a = traceAttributes({ ...input, toolNames: Array.from({ length: 80 }, (_, i) => `tool_number_${i}`) });
    expect(JSON.stringify(a.metadata.tools).length).toBeLessThanOrEqual(200);
  });
});
