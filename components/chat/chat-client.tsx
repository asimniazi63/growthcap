"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { ArrowUp, Boxes, Check, LoaderCircle, MessageSquareText, Plus, Receipt, ShieldCheck, ShoppingBag, Sparkles, TicketPercent, Trash2, TrendingUp, TriangleAlert, Undo2, Users, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionView } from "@/lib/actions/types";
import { linkClaims, type MatchedClaim } from "@/lib/agent/links";
import type { ProvenanceEntry } from "@/lib/agent/run";
import type { Role } from "@/lib/tenancy/context";
import type { ViewPayload } from "@/lib/views/types";
import { BrandMark } from "../shell/brand";
import { ActionCard } from "../actions/action-card";
import { PinButton } from "../views/pin-button";
import { ViewRenderer } from "../views/view-renderer";
import { MemoryCard, type MemoryCardState } from "./memory-card";
import { ERROR_COPY, ErrorBanner, type ChatErrorCode } from "./error-banner";
import { SafeMarkdown, toolLabel } from "./safe-markdown";

interface Verification {
  attempt: number;
  ok: boolean;
  unmatched: { text: string; value: number }[];
  matched: MatchedClaim[];
}

type Part = UIMessage["parts"][number];

// These show their result (a view, a note card, an approval card), not a status line.
const QUIET_TOOLS = new Set(["render_view", "remember", "propose_action", "draft_landing_page"]);
const toolName = (p: Part) => (p.type.startsWith("tool-") ? p.type.slice("tool-".length) : null);
const dataOf = <T,>(m: UIMessage, type: string): T | undefined => (m.parts.findLast((p) => p.type === type) as { data?: T } | undefined)?.data;

function codeOf(error: Error | undefined): ChatErrorCode | null {
  if (!error) return null;
  const text = error.message.trim();
  return text in ERROR_COPY ? (text as ChatErrorCode) : "INTERNAL_ERROR";
}

// One step of what the assistant looked at, drawn as a point on a quiet timeline.
function ToolChip({ part }: { part: Part }) {
  const name = toolName(part);
  if (!name) return null;
  const state = (part as { state?: string }).state;
  const done = state === "output-available";
  const failed = state === "output-error";
  const label = toolLabel(name).toLowerCase();
  return (
    <li className={`relative flex items-center text-[0.8125rem] leading-5 ${failed ? "text-behind" : "text-ink-3"}`}>
      <span aria-hidden className="absolute -left-[23.5px] grid size-3.5 place-items-center rounded-full bg-paper">
        {done ? <Check className="size-3 text-brand" strokeWidth={3} /> : failed ? <TriangleAlert className="size-3 text-behind" /> : <LoaderCircle className="size-3 animate-spin text-ink-3 motion-reduce:animate-none" />}
      </span>
      {done ? `Checked ${label}` : failed ? `Couldn't read ${label}` : `Looking at ${label}…`}
    </li>
  );
}

function AssistantMessage({ message, role, currency, userId }: { message: UIMessage; role: Role; currency: string; userId?: string }) {
  const provenanceList = dataOf<ProvenanceEntry[]>(message, "data-provenance") ?? [];
  const provenance = Object.fromEntries(provenanceList.map((p) => [p.queryId, p]));
  const verification = dataOf<Verification>(message, "data-verification");
  const repairAt = message.parts.findIndex((p) => p.type === "data-repair");
  const lastText = message.parts.findLastIndex((p) => p.type === "text");
  const truncated = provenanceList.filter((p) => p.truncated);
  // A call that failed and was then made again successfully (the model fixing its own arguments) is not worth a red line.
  const toolParts = message.parts.filter((p) => toolName(p) && !QUIET_TOOLS.has(toolName(p)!));
  const chips = toolParts.filter((p, i) => (p as { state?: string }).state !== "output-error" || !toolParts.slice(i + 1).some((q) => toolName(q) === toolName(p) && (q as { state?: string }).state === "output-available"));

  return (
    <div className="space-y-3.5">
      {chips.length > 0 ? (
        <ul aria-label="What the assistant looked at" className="ml-[7px] space-y-1.5 border-l border-line pl-4">
          {chips.map((p, i) => (
            <ToolChip key={i} part={p} />
          ))}
        </ul>
      ) : null}
      {message.parts.map((p, i) => {
        if (p.type === "data-view") {
          const view = (p as { data: ViewPayload }).data;
          return (
            <div key={i} className="space-y-2">
              <ViewRenderer data={view.data} title={view.title} currency={currency} />
              <PinButton title={view.title} component={view.component} sources={view.sources} />
            </div>
          );
        }
        if (p.type === "data-memory") {
          const note = (p as { data: { id: string; text: string; status: MemoryCardState } }).data;
          return <MemoryCard key={i} id={note.id} text={note.text} status={note.status} canDecide={role === "gc_admin" || role === "gc_partner"} />;
        }
        if (p.type === "data-action") {
          const action = (p as { data: ActionView }).data;
          return <ActionCard key={i} action={action} canDecide={role === "gc_admin" || role === "gc_partner"} me={userId} />;
        }
        if (p.type !== "text") return null;
        const text = (p as { text: string }).text;
        if (repairAt >= 0 && i < repairAt) {
          return (
            <details key={i} className="max-w-[70ch] text-xs text-ink-3">
              <summary className="cursor-pointer">First draft, replaced because some numbers couldn&apos;t be checked</summary>
              <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-paper-2 px-3 py-2 text-ink-2">{text}</p>
            </details>
          );
        }
        // The matched spans belong to the final answer, so only that text gets clickable numbers.
        const final = i === lastText && verification?.matched ? linkClaims(text, verification.matched) : text;
        return <SafeMarkdown key={i} text={final} provenance={provenance} />;
      })}
      {truncated.map((p) => (
        <p key={p.queryId} className="num text-xs text-ink-3">
          Showing {p.truncated!.shown} of {p.truncated!.total}.
        </p>
      ))}
      {verification ? (
        verification.ok ? (
          <p className="flex items-start gap-1.5 text-xs leading-5 text-ink-3">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand-strong" aria-hidden />
            Every number here was checked against the store data. Click one to see where it came from.
          </p>
        ) : (
          <div role="status" className="flex max-w-[70ch] items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-tint px-3.5 py-3 text-sm leading-6 text-ink">
            <TriangleAlert className="mt-1 size-4 shrink-0 text-warn" aria-hidden />
            <p>
              Couldn&apos;t verify: {verification.unmatched.map((u) => u.text).join(", ")}. Treat {verification.unmatched.length === 1 ? "that number" : "those numbers"} with care.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}

// A small icon for each suggested question, picked from what it asks about.
function tileIcon(question: string): LucideIcon {
  const q = question.toLowerCase();
  if (/stock|inventory|run out/.test(q)) return Boxes;
  if (/refund/.test(q)) return Undo2;
  if (/discount|code/.test(q)) return TicketPercent;
  if (/average order/.test(q)) return Receipt;
  if (/customer/.test(q)) return Users;
  if (/product/.test(q)) return ShoppingBag;
  if (/sales|revenue/.test(q)) return TrendingUp;
  return Sparkles;
}

interface ChatProps {
  role: Role;
  models: { id: string; label: string }[];
  defaultModelId: string;
  suggestions: readonly string[];
  currency: string;
  userId?: string; // the signed-in person, so an action card can say "you"
}

// One conversation. The server keeps the model's history; the browser sends only the newest question and the thread id,
// which arrives in the stream (data-thread) once the first answer starts.
function ChatSession({ role, models, defaultModelId, suggestions, currency, userId, threadId, initial, onSaved, onThread }: ChatProps & { threadId: string | null; initial: UIMessage[]; onSaved: () => void; onThread: (id: string) => void }) {
  const threadRef = useRef<string | null>(threadId);
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", prepareSendMessagesRequest: ({ messages, body }) => ({ body: { ...body, messages: messages.slice(-1) } }) }),
    [],
  );
  const { messages, sendMessage, regenerate, status, error } = useChat({
    transport,
    messages: initial,
    onData: (part) => {
      if (part.type === "data-thread") {
        threadRef.current = (part.data as { id: string }).id;
        onThread(threadRef.current);
      }
    },
    onFinish: () => onSaved(),
  });
  const [input, setInput] = useState("");
  const [modelId, setModelId] = useState(defaultModelId);
  const end = useRef<HTMLDivElement>(null);
  const busy = status === "submitted" || status === "streaming";
  const code = codeOf(error);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, status]);

  const ask = (text: string) => {
    const clean = text.trim();
    if (!clean || busy) return;
    setInput("");
    void sendMessage({ text: clean }, { body: { modelId, ...(threadRef.current ? { threadId: threadRef.current } : {}) } });
  };

  return (
    <div className="flex min-h-[65dvh] min-w-0 flex-col lg:min-h-0">
      <div className="-mx-1 flex-1 px-1 lg:min-h-0 lg:overflow-y-auto lg:pr-3">
        <div className="mx-auto w-full max-w-3xl space-y-6 pb-6">
          {messages.length === 0 ? (
            <div className="pt-4 lg:pt-10">
              <div className="flex flex-col items-center text-center">
                <BrandMark className="size-10" />
                <h2 className="mt-4 text-[1.625rem] font-semibold leading-tight">What do you want to know about this store?</h2>
                <p className="muted mt-2 max-w-[52ch]">Ask about this store&apos;s sales, orders, products, stock or customers. Every figure in an answer is checked against the store&apos;s data. Try one of these:</p>
              </div>
              <ul className="mt-8 grid gap-2.5 md:grid-cols-2">
                {suggestions.map((q) => {
                  const Icon = tileIcon(q);
                  return (
                    <li key={q} className="flex">
                      <button type="button" onClick={() => ask(q)} className="card flex w-full items-start gap-3 p-3.5 text-left text-sm leading-snug transition-colors hover:border-line-strong hover:bg-paper">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand-strong">
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="pt-1">{q}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <ol className="space-y-7">
              {messages.map((m) => (
                <li key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
                  {m.role === "user" ? (
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[0.9375rem] leading-6 text-white">{m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</p>
                  ) : (
                    <div className="flex gap-3">
                      <span className="mt-0.5 shrink-0">
                        <BrandMark className="size-6" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <AssistantMessage message={m} role={role} currency={currency} userId={userId} />
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}

          {busy && messages.at(-1)?.role === "user" ? (
            <div role="status" className="flex items-center gap-3 text-sm text-ink-3">
              <BrandMark className="size-6" />
              <span className="inline-flex items-center gap-2">
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
                Thinking…
              </span>
            </div>
          ) : null}
          {code ? <ErrorBanner code={code} role={role} onRetry={() => void regenerate({ body: { modelId, ...(threadRef.current ? { threadId: threadRef.current } : {}) } })} /> : null}
          <div ref={end} />
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 bg-paper px-1 pb-3 pt-2 lg:static lg:shrink-0 lg:pb-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="card mx-auto w-full max-w-3xl rounded-2xl p-2 transition-shadow focus-within:border-brand focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-brand)_22%,transparent)]"
        >
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="question">
              Your question
            </label>
            <input
              id="question"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={2000}
              placeholder="Ask about sales, orders, stock or customers"
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[0.9375rem] outline-none placeholder:text-ink-3"
            />
            <button type="submit" disabled={busy || !input.trim()} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-brand text-white transition-colors enabled:hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-40">
              <ArrowUp className="size-4.5" strokeWidth={2.5} aria-hidden />
              <span className="sr-only">Ask</span>
            </button>
          </div>
          {models.length > 1 ? (
            <div className="mt-1.5 flex items-center border-t border-line px-1 pt-2">
              <label className="flex items-center gap-2 text-xs text-ink-3">
                Model
                <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="field w-auto py-1 pl-2.5 text-xs">
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}

interface ThreadItem {
  id: string;
  title: string;
}

async function fetchThreads(): Promise<ThreadItem[] | null> {
  const res = await fetch("/api/threads").catch(() => null);
  return res?.ok ? ((await res.json()) as { threads: ThreadItem[] }).threads : null;
}

export function ChatClient(props: ChatProps) {
  const [session, setSession] = useState<{ key: number; threadId: string | null; initial: UIMessage[] }>({ key: 0, threadId: null, initial: [] });
  const [threads, setThreads] = useState<ThreadItem[]>([]);
  const [problem, setProblem] = useState("");

  const refresh = useCallback(() => fetchThreads().then((list) => list && setThreads(list)), []);
  useEffect(() => {
    let alive = true;
    void fetchThreads().then((list) => alive && list && setThreads(list));
    return () => {
      alive = false;
    };
  }, []);

  const fresh = () => {
    setProblem("");
    setSession((s) => ({ key: s.key + 1, threadId: null, initial: [] }));
  };
  async function open(id: string) {
    const res = await fetch(`/api/threads/${id}`).catch(() => null);
    if (!res?.ok) return setProblem("Couldn't open that conversation.");
    const saved = (await res.json()) as { messages: UIMessage[] };
    setProblem("");
    setSession((s) => ({ key: s.key + 1, threadId: id, initial: saved.messages }));
  }
  async function remove(id: string) {
    const res = await fetch(`/api/threads/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setProblem("Couldn't delete that conversation.");
    if (session.threadId === id) fresh();
    void refresh();
  }

  const active = session.threadId;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-6">
      {/* Small screens: a compact bar above the conversation. */}
      <div className="flex flex-wrap items-center gap-2 lg:hidden">
        <button type="button" onClick={fresh} className="btn btn-secondary btn-sm shrink-0">
          <Plus className="size-4" aria-hidden />
          New chat
        </button>
        {threads.length > 0 ? (
          <>
            <label className="sr-only" htmlFor="saved-chats">
              Saved conversations
            </label>
            <select id="saved-chats" value={active ?? ""} onChange={(e) => (e.target.value ? void open(e.target.value) : fresh())} className="field min-w-0 flex-1 py-1.5 text-sm">
              <option value="">Saved conversations…</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            {active ? (
              <button type="button" onClick={() => void remove(active)} className="btn btn-danger btn-sm shrink-0 px-2.5">
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only">Delete this conversation</span>
              </button>
            ) : null}
          </>
        ) : null}
        {problem ? (
          <p role="alert" className="w-full text-xs text-behind">
            {problem}
          </p>
        ) : null}
      </div>

      {/* Large screens: the saved conversations as a list beside the chat. */}
      <aside aria-label="Conversations" className="card hidden min-h-0 flex-col lg:flex">
        <div className="border-b border-line p-3">
          <button type="button" onClick={fresh} className="btn btn-secondary w-full">
            <Plus className="size-4" aria-hidden />
            New chat
          </button>
        </div>
        {threads.length > 0 ? (
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
            {threads.map((t) => {
              const current = t.id === active;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => (current ? undefined : void open(t.id))}
                    aria-current={current ? "true" : undefined}
                    className={`flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm leading-snug transition-colors ${current ? "bg-brand-tint font-medium text-brand-strong" : "text-ink-2 hover:bg-paper"}`}
                  >
                    <MessageSquareText className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="line-clamp-2">{t.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="faint flex-1 p-4 text-sm">Conversations you start are saved here.</p>
        )}
        {active || problem ? (
          <div className="space-y-2 border-t border-line p-3">
            {problem ? (
              <p role="alert" className="text-xs text-behind">
                {problem}
              </p>
            ) : null}
            {active ? (
              <button type="button" onClick={() => void remove(active)} className="btn btn-danger btn-sm w-full">
                <Trash2 className="size-4" aria-hidden />
                Delete this conversation
              </button>
            ) : null}
          </div>
        ) : null}
      </aside>

      <ChatSession key={session.key} {...props} threadId={session.threadId} initial={session.initial} onSaved={refresh} onThread={(id) => setSession((s) => (s.threadId === id ? s : { ...s, threadId: id }))} />
    </div>
  );
}
