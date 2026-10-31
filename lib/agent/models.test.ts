import { describe, expect, it } from "vitest";
import { availableModels, costUsd, defaultModelId, MODELS, resolveModel, retryModelFor } from "./models";

const OFF = {} as Record<string, string | undefined>;
const CLAUDE_ON = { BEDROCK_CLAUDE_ENABLED: "true" };

describe("the model registry", () => {
  it("has unique ids, positive prices, and a Bedrock id for each model", () => {
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
    for (const m of MODELS) {
      expect(m.bedrockId).toBeTruthy();
      expect(m.inputUsdPerMTok).toBeGreaterThan(0);
      expect(m.outputUsdPerMTok).toBeGreaterThan(0);
    }
  });

  it("offers only Devstral until Claude access is switched on", () => {
    expect(availableModels(OFF).map((m) => m.id)).toEqual(["devstral-2"]);
    expect(availableModels(CLAUDE_ON).map((m) => m.id)).toEqual(expect.arrayContaining(["devstral-2", "claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"]));
  });

  it("defaults the chat to Devstral now, and to Sonnet once Claude is on", () => {
    expect(defaultModelId("chat", OFF)).toBe("devstral-2");
    expect(defaultModelId("chat", CLAUDE_ON)).toBe("claude-sonnet-5-5");
    expect(defaultModelId("summary", CLAUDE_ON)).toBe("claude-haiku-5-5");
    expect(defaultModelId("why", CLAUDE_ON)).toBe("claude-opus-5-5");
    expect(defaultModelId("why", OFF)).toBe("devstral-2");
  });
});

describe("resolveModel: the server decides which model runs", () => {
  it("uses the role's default when nothing is asked for", () => {
    expect(resolveModel(undefined, "chat", OFF).id).toBe("devstral-2");
  });
  it("accepts an id from the registry that is available", () => {
    expect(resolveModel("claude-opus-5-5", "chat", CLAUDE_ON).id).toBe("claude-opus-5-5");
  });
  it("rejects an unknown id, a raw Bedrock id, and a model that is not switched on", () => {
    for (const bad of ["gpt-9", "mistral.devstral-2-123b", "global.anthropic.claude-sonnet-5-5", "", "__proto__"]) {
      expect(() => resolveModel(bad, "chat", CLAUDE_ON), bad).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
    }
    expect(() => resolveModel("claude-sonnet-5-5", "chat", OFF)).toThrowError(expect.objectContaining({ code: "INVALID_INPUT" }));
  });
});

describe("costUsd", () => {
  it("prices input and output tokens per million", () => {
    const m = resolveModel("claude-sonnet-5-5", "chat", CLAUDE_ON);
    expect(costUsd(m, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(m.inputUsdPerMTok + m.outputUsdPerMTok, 9);
    expect(costUsd(m, { inputTokens: 2000, outputTokens: 500 })).toBeCloseTo((2000 * m.inputUsdPerMTok + 500 * m.outputUsdPerMTok) / 1e6, 9);
  });
  it("counts missing usage as zero", () => {
    expect(costUsd(MODELS[0]!, {})).toBe(0);
  });
});

describe("retryModelFor", () => {
  it("retries once on the same model", () => {
    const m = MODELS[0]!;
    expect(retryModelFor(m)).toBe(m);
  });
});
