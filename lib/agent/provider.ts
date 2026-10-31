import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import type { JSONValue, LanguageModel } from "ai";
import type { ModelSpec } from "./models";

// The only place the Bedrock provider is created. It reads AWS_BEARER_TOKEN_BEDROCK itself; the region comes from the
// registry, so the chat can't point at another region or another model.
export function createModel(spec: ModelSpec): LanguageModel {
  return createAmazonBedrock({ region: spec.region })(spec.bedrockId);
}

export function providerOptionsFor(spec: ModelSpec): { bedrock: { additionalModelRequestFields: Record<string, JSONValue> } } | undefined {
  return spec.requestFields ? { bedrock: { additionalModelRequestFields: spec.requestFields } } : undefined;
}
