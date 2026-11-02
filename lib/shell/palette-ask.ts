import { DefaultChatTransport, readUIMessageStream, type UIMessage } from "ai";
import type { AnswerCheck } from "@/lib/overview/pinned-answers";

// Asking a question from the search window. It posts to the same /api/chat route as the Chat page and reads the same stream, so
// the server does everything it does there: the tenant comes from the Clerk session, the answer is checked against the tools'
// results, and the question is saved as a conversation once its first answer has succeeded. Only the question text is sent.

// What the window shows from the answer message as it streams in.
export interface AnswerView {
  text: string; // the final answer's text so far, exactly as streamed
  phase: "waiting" | "reading" | "writing";
  check?: AnswerCheck;
  threadId?: string;
}

type Loose = { type: string; state?: string; text?: string; data?: unknown };

const isTool = (p: Loose) => p.type.startsWith("tool-") || p.type === "dynamic-tool";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const listLength = (v: unknown) => (Array.isArray(v) ? v.length : 0);

// The answer is the text that comes after the last tool call and after a repair marker: the lines the model wrote before looking
// something up, and a first draft that was replaced, are not part of it. This is the same text the Chat page shows as the answer.
export function answerView(message: UIMessage): AnswerView {
  const parts = message.parts as unknown as Loose[];
  let from = -1;
  parts.forEach((p, i) => {
    if (isTool(p) || p.type === "data-repair") from = i;
  });
  const text = parts
    .slice(from + 1)
    .flatMap((p) => (p.type === "text" && typeof p.text === "string" ? [p.text] : []))
    .join("\n\n");
  const reading = parts.some((p) => isTool(p) && p.state !== "output-available" && p.state !== "output-error");
  const view: AnswerView = { text, phase: text ? "writing" : reading ? "reading" : "waiting" };

  // A verification counts only when it comes after the final text, as in the chat: while a corrected answer is arriving, the first draft's check is not about it.
  const lastText = parts.findLastIndex((p) => p.type === "text");
  const at = parts.findLastIndex((p) => p.type === "data-verification");
  const verdict = at > lastText && lastText >= 0 && isRecord(parts[at]?.data) ? parts[at]!.data : null;
  if (isRecord(verdict) && typeof verdict.ok === "boolean") {
    const traced = listLength(verdict.matched);
    view.check = { ok: verdict.ok, traced, total: traced + listLength(verdict.unmatched) };
  }

  const thread = parts.find((p) => p.type === "data-thread")?.data;
  if (isRecord(thread) && typeof thread.id === "string") view.threadId = thread.id;
  return view;
}

export interface AskRun {
  question: string;
  signal: AbortSignal;
  onUpdate: (view: AnswerView) => void;
  fetch?: typeof fetch; // for tests
}

// Streams one question to the end. Resolves with the final view, or throws what went wrong (see problemCode). A stop through the
// signal also throws, and the caller decides that it was a stop.
export async function runAsk({ question, signal, onUpdate, fetch: fetchImpl }: AskRun): Promise<AnswerView> {
  const transport = new DefaultChatTransport({
    api: "/api/chat",
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: messages.slice(-1) } }),
  });
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: "search-window",
    messageId: undefined,
    messages: [{ id: "search-window-question", role: "user", parts: [{ type: "text", text: question }] }],
    abortSignal: signal,
  });

  let streamError: unknown = null;
  let last: AnswerView = { text: "", phase: "waiting" };
  for await (const message of readUIMessageStream({ stream, onError: (e) => void (streamError ??= e) })) {
    last = answerView(message);
    onUpdate(last);
  }
  if (streamError) throw streamError;
  return last;
}

// The server sends a short code (BUDGET_EXCEEDED, FORBIDDEN, ...) as the error text, over HTTP or inside the stream. Anything else is
// a network failure or an unexpected reply, and the provider's own message is never shown.
export function problemCode(error: unknown): string {
  const text = error instanceof Error ? error.message.trim() : "";
  if (/^[A-Z][A-Z_]+$/.test(text)) return text;
  return error instanceof TypeError ? "NETWORK" : "INTERNAL_ERROR";
}

interface Asked {
  question: string;
  askedAt: string; // ISO time the question was sent
  view: AnswerView;
}

export type AskState = { status: "idle" } | ({ status: "asking" } & Asked) | ({ status: "done" } & Asked) | ({ status: "stopped" } & Asked) | ({ status: "failed"; code: string } & Asked);

export type AskAction =
  | { type: "start"; question: string; at: string }
  | { type: "update"; view: AnswerView }
  | { type: "finish"; view: AnswerView }
  | { type: "stop" }
  | { type: "fail"; code: string }
  | { type: "reset" };

export const IDLE: AskState = { status: "idle" };
const EMPTY: AnswerView = { text: "", phase: "waiting" };

export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case "start":
      return state.status === "asking" ? state : { status: "asking", question: action.question, askedAt: action.at, view: EMPTY };
    case "update":
      return state.status === "asking" ? { ...state, view: action.view } : state;
    case "finish":
      return state.status === "asking" ? { ...state, status: "done", view: action.view } : state;
    case "stop":
      return state.status === "asking" ? { ...state, status: "stopped" } : state;
    case "fail":
      return state.status === "asking" ? { ...state, status: "failed", code: action.code } : state;
    case "reset":
      return IDLE;
  }
}

// An answer can be pinned once it has finished. A stopped or failed one is partial.
export const canPin = (state: AskState): state is Extract<AskState, { status: "done" }> => state.status === "done" && state.view.text.trim() !== "";

// What typing in the search window offers. A question (it ends with ? or runs to four words) is offered first, so Enter asks it.
// Two or more words that match no page, brand or suggested question are offered as a question too, as the only row.
const QUESTION_WORDS = 4;
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return t.endsWith("?") || wordCount(t) >= QUESTION_WORDS;
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function askRowPlacement(query: string, matches: number): "first" | "only" | "none" {
  const words = wordCount(query);
  if (words === 0) return "none";
  if (looksLikeQuestion(query)) return matches === 0 ? "only" : "first";
  return matches === 0 && words >= 2 ? "only" : "none"; // one word that matches nothing is more likely a typo than a question
}
