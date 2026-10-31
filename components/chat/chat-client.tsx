"use client";

import { DefaultChatTransport, type UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { linkClaims, type MatchedClaim } from "@/lib/agent/links";
import type { ProvenanceEntry } from "@/lib/agent/run";
import type { Role } from "@/lib/tenancy/context";
import type { ViewPayload } from "@/lib/views/types";
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

const toolName = (p: Part) => (p.type.startsWith("tool-") ? p.type.slice("tool-".length) : null);
const dataOf = <T,>(m: UIMessage, type: string): T | undefined => (m.parts.findLast((p) => p.type === type) as { data?: T } | undefined)?.data;

function codeOf(error: Error | undefined): ChatErrorCode | null {
  if (!error) return null;
  const text = error.message.trim();
  return text in ERROR_COPY ? (text as ChatErrorCode) : "INTERNAL_ERROR";
}

function ToolChip({ part }: { part: Part }) {
  const name = toolName(part);
  if (!name) return null;
  const state = (part as { state?: string }).state;
  const done = state === "output-available";
  const failed = state === "output-error";
  return (
    <li className={`flex items-center gap-2 text-xs ${failed ? "text-red-700" : "text-neutral-500"}`}>
      <span aria-hidden className={`inline-block size-1.5 rounded-full ${done ? "bg-emerald-500" : failed ? "bg-red-500" : "animate-pulse bg-neutral-400"}`} />
      {done ? `Checked ${toolLabel(name).toLowerCase()}` : failed ? `Couldn't read ${toolLabel(name).toLowerCase()}` : `Looking at ${toolLabel(name).toLowerCase()}…`}
    </li>
  );
}

function AssistantMessage({ message, role, currency }: { message: UIMessage; role: Role; currency: string }) {
  const provenanceList = dataOf<ProvenanceEntry[]>(message, "data-provenance") ?? [];
  const provenance = Object.fromEntries(provenanceList.map((p) => [p.queryId, p]));
  const verification = dataOf<Verification>(message, "data-verification");
  const repairAt = message.parts.findIndex((p) => p.type === "data-repair");
  const lastText = message.parts.findLastIndex((p) => p.type === "text");
  const truncated = provenanceList.filter((p) => p.truncated);
  // A call that failed and was then made again successfully (the model fixing its own arguments) is not worth a red line.
  // render_view and remember show their result (a view, a note card), not a status line.
  const toolParts = message.parts.filter((p) => toolName(p) && toolName(p) !== "render_view" && toolName(p) !== "remember");
  const chips = toolParts.filter((p, i) => (p as { state?: string }).state !== "output-error" || !toolParts.slice(i + 1).some((q) => toolName(q) === toolName(p) && (q as { state?: string }).state === "output-available"));

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {chips.map((p, i) => (
          <ToolChip key={i} part={p} />
        ))}
      </ul>
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
        if (p.type !== "text") return null;
        const text = (p as { text: string }).text;
        if (repairAt >= 0 && i < repairAt) {
          return (
            <details key={i} className="text-xs text-neutral-500">
              <summary className="cursor-pointer">First draft, replaced because some numbers couldn&apos;t be checked</summary>
              <p className="mt-1 whitespace-pre-wrap">{text}</p>
            </details>
          );
        }
        // The matched spans belong to the final answer, so only that text gets clickable numbers.
        const final = i === lastText && verification?.matched ? linkClaims(text, verification.matched) : text;
        return <SafeMarkdown key={i} text={final} provenance={provenance} />;
      })}
      {truncated.map((p) => (
        <p key={p.queryId} className="text-xs text-neutral-500">
          Showing {p.truncated!.shown} of {p.truncated!.total}.
        </p>
      ))}
      {verification ? (
        verification.ok ? (
          <p className="text-xs text-emerald-700">Every number here was checked against the store data. Click one to see where it came from.</p>
        ) : (
          <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Couldn&apos;t verify: {verification.unmatched.map((u) => u.text).join(", ")}. Treat {verification.unmatched.length === 1 ? "that number" : "those numbers"} with care.
          </p>
        )
      ) : null}
    </div>
  );
}

interface ChatProps {
  role: Role;
  models: { id: string; label: string }[];
  defaultModelId: string;
  suggestions: readonly string[];
  currency: string;
}

// One conversation. The server keeps the model's history; the browser sends only the newest question and the thread id,
// which arrives in the stream (data-thread) once the first answer starts.
function ChatSession({ role, models, defaultModelId, suggestions, currency, threadId, initial, onSaved, onThread }: ChatProps & { threadId: string | null; initial: UIMessage[]; onSaved: () => void; onThread: (id: string) => void }) {
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
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <div>
          <p className="text-sm text-neutral-600">Ask about this store&apos;s sales, orders, products, stock or customers. Try one of these:</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {suggestions.map((q) => (
              <button key={q} type="button" onClick={() => ask(q)} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left text-sm hover:border-neutral-400">
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol className="space-y-5">
          {messages.map((m) => (
            <li key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              {m.role === "user" ? (
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-4 py-2 text-sm text-white">{m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</p>
              ) : (
                <div className="max-w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3">
                  <AssistantMessage message={m} role={role} currency={currency} />
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {busy && messages.at(-1)?.role === "user" ? <p className="text-xs text-neutral-500">Thinking…</p> : null}
      {code ? <ErrorBanner code={code} role={role} onRetry={() => void regenerate({ body: { modelId, ...(threadRef.current ? { threadId: threadRef.current } : {}) } })} /> : null}
      <div ref={end} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="sticky bottom-0 space-y-2 border-t border-neutral-200 bg-neutral-50 py-3"
      >
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="question">
            Your question
          </label>
          <input
            id="question"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={2000}
            placeholder="Ask about sales, orders, stock or customers"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
          <button type="submit" disabled={busy || !input.trim()} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50">
            Ask
          </button>
        </div>
        {models.length > 1 ? (
          <label className="flex items-center gap-2 text-xs text-neutral-600">
            Model
            <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="rounded-md border border-neutral-300 bg-white px-2 py-1">
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </form>
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={fresh} className="rounded-md border border-neutral-300 bg-white px-3 py-1 hover:border-neutral-500">
          New chat
        </button>
        {threads.length > 0 ? (
          <>
            <label className="sr-only" htmlFor="saved-chats">
              Saved conversations
            </label>
            <select
              id="saved-chats"
              value={session.threadId ?? ""}
              onChange={(e) => (e.target.value ? void open(e.target.value) : fresh())}
              className="max-w-xs rounded-md border border-neutral-300 bg-white px-2 py-1"
            >
              <option value="">Saved conversations…</option>
              {threads.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            {session.threadId ? (
              <button type="button" onClick={() => void remove(session.threadId!)} className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-neutral-600 hover:border-neutral-500">
                Delete this conversation
              </button>
            ) : null}
          </>
        ) : null}
        {problem ? <span role="alert" className="text-xs text-red-700">{problem}</span> : null}
      </div>
      <ChatSession key={session.key} {...props} threadId={session.threadId} initial={session.initial} onSaved={refresh} onThread={(id) => setSession((s) => (s.threadId === id ? s : { ...s, threadId: id }))} />
    </div>
  );
}
