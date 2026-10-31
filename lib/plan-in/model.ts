import { resolveModel } from "../agent/models";
import { createModel, providerOptionsFor } from "../agent/provider";
import type { ReaderDeps } from "./read";

// The model that reads a SOW. The server picks it (the chat role's model unless a script names another from the registry);
// an upload never names one.
export function readerDeps(env: Record<string, string | undefined> = process.env, modelId?: string): ReaderDeps {
  const spec = resolveModel(modelId, "chat", env);
  return { model: createModel(spec), providerOptions: providerOptionsFor(spec) };
}
