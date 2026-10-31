import type { JSONValue } from "ai";
import { AppError } from "../errors";

// The registry of models the agent may use. The server decides which one runs: the chat picker sends one of these ids
// (never a Bedrock id), and anything else is refused. Prices are what the spend cap uses.

export type ModelRole = "chat" | "why" | "summary";
type Env = Record<string, string | undefined>;

export interface ModelSpec {
  id: string; // the app's own id: safe to send from the browser
  label: string;
  bedrockId: string;
  region: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  // "published" prices are the provider's list prices for this model; "estimated" ones are not confirmed for Bedrock.
  // They only feed the spend cap, so a small error loosens or tightens the cap, and nothing is billed from them.
  priceBasis: "published" | "estimated";
  // Whether tool calls are known to work while streaming. Not verified for Devstral: see docs/decisions/0000-setup.md.
  streamsToolCalls: boolean;
  isEnabled: (env: Env) => boolean;
  // Extra request fields for this model (for Claude, reasoning effort). Applied by lib/agent/provider.ts.
  requestFields?: Record<string, JSONValue>;
}

const claudeOn = (env: Env) => env.BEDROCK_CLAUDE_ENABLED === "true";
const CLAUDE_REGION = "eu-central-1";

export const MODELS: ModelSpec[] = [
  {
    id: "devstral-2",
    label: "Devstral 2",
    bedrockId: "mistral.devstral-2-123b",
    region: "eu-central-1",
    inputUsdPerMTok: 0.4,
    outputUsdPerMTok: 2.0,
    priceBasis: "estimated",
    streamsToolCalls: false,
    isEnabled: () => true,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    bedrockId: "eu.anthropic.claude-sonnet-4-6", // the EU inference profile
    region: "eu-central-1",
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
    priceBasis: "estimated", // Anthropic's list price; Bedrock's can differ
    streamsToolCalls: true,
    isEnabled: () => true,
  },
  {
    id: "kimi-k3",
    label: "Kimi K3 (slow)",
    bedrockId: "global.moonshotai.kimi-k3", // the global inference profile
    region: "eu-central-1",
    inputUsdPerMTok: 1, // a cautious guess: the price is not confirmed, and it only feeds the spend cap
    outputUsdPerMTok: 4,
    priceBasis: "estimated",
    streamsToolCalls: false,
    isEnabled: () => true,
  },
  {
    id: "minimax-m2-5",
    label: "MiniMax M2.5",
    bedrockId: "minimax.minimax-m2.5",
    region: "eu-central-1",
    inputUsdPerMTok: 0.5, // a cautious guess: the price is not confirmed, and it only feeds the spend cap
    outputUsdPerMTok: 2,
    priceBasis: "estimated",
    streamsToolCalls: false,
    isEnabled: () => true,
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    bedrockId: "global.anthropic.claude-sonnet-5-5",
    region: CLAUDE_REGION,
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
    priceBasis: "estimated", // Anthropic's own list price; Bedrock's can differ
    streamsToolCalls: true,
    isEnabled: claudeOn,
    requestFields: { output_config: { effort: "low" } }, // start low for chat: Sonnet 5.5 defaults to high and thinks before replying
  },
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    bedrockId: "global.anthropic.claude-opus-5-5",
    region: CLAUDE_REGION,
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    priceBasis: "estimated",
    streamsToolCalls: true,
    isEnabled: claudeOn,
    requestFields: { output_config: { effort: "medium" } },
  },
  {
    id: "claude-haiku-5-5",
    label: "Claude Haiku 5.5",
    bedrockId: "global.anthropic.claude-haiku-5-5",
    region: CLAUDE_REGION,
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
    priceBasis: "estimated",
    streamsToolCalls: true,
    isEnabled: claudeOn,
    requestFields: { output_config: { effort: "low" } },
  },
];

export const availableModels = (env: Env = process.env): ModelSpec[] => MODELS.filter((m) => m.isEnabled(env));

const CLAUDE_DEFAULTS: Record<ModelRole, string> = { chat: "claude-sonnet-5-5", why: "claude-opus-5-5", summary: "claude-haiku-5-5" };
// Sonnet 4.6 is the default until Claude 5.5 is approved for the account (BEDROCK_CLAUDE_ENABLED=true switches the defaults to it).
const DEFAULT_MODEL = "claude-sonnet-4-6";

export function defaultModelId(role: ModelRole, env: Env = process.env): string {
  return claudeOn(env) ? CLAUDE_DEFAULTS[role] : DEFAULT_MODEL;
}

// `requested` comes from the client (the picker). Only ids in the registry that are switched on are accepted.
export function resolveModel(requested: string | undefined, role: ModelRole, env: Env = process.env): ModelSpec {
  const id = requested ?? defaultModelId(role, env);
  const spec = availableModels(env).find((m) => m.id === id);
  if (!spec) throw new AppError("INVALID_INPUT", `Unknown or unavailable model: ${JSON.stringify(id).slice(0, 60)}`);
  return spec;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export function costUsd(spec: ModelSpec, usage: TokenUsage): number {
  return ((usage.inputTokens ?? 0) * spec.inputUsdPerMTok + (usage.outputTokens ?? 0) * spec.outputUsdPerMTok) / 1e6;
}

// After a timeout or a 5xx the turn is retried once on the same model (the plan's T4 change); the SDK does that inside the
// call. If it still fails before any answer text has streamed, the turn moves once to the fallback model below.
export const retryModelFor = (spec: ModelSpec): ModelSpec => spec;

// The model a turn moves to when the one that was asked for is down. AGENT_FALLBACK_MODEL_ID (a key in the registry) wins
// when it is set and available. Otherwise it is Opus 5.5 once Claude 5.5 is approved (BEDROCK_CLAUDE_ENABLED), and Devstral 2
// until then. It is never the model that just failed; null means there is nothing else to try.
export function fallbackModelFor(primary: ModelSpec, env: Env = process.env): ModelSpec | null {
  const available = availableModels(env);
  const wanted = env.AGENT_FALLBACK_MODEL_ID?.trim();
  const candidates = [wanted, claudeOn(env) ? "claude-opus-5-5" : undefined, "devstral-2", "claude-sonnet-4-6"];
  for (const id of candidates) {
    const spec = id ? available.find((m) => m.id === id) : undefined;
    if (spec && spec.id !== primary.id) return spec;
  }
  return null;
}
