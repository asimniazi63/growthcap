import type { UIMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { answerView, askReducer, askRowPlacement, canPin, IDLE, looksLikeQuestion, problemCode, runAsk, type AnswerView, type AskState } from "./palette-ask";

// No test here reaches the network: runAsk is given a stand-in fetch that returns a canned stream.

const THREAD = "6f1c1c3e-2f7e-4b8a-9d3c-0a1b2c3d4e5f";
type Chunk = Record<string, unknown>;

const text = (id: string, ...deltas: string[]): Chunk[] => [{ type: "text-start", id }, ...deltas.map((delta) => ({ type: "text-delta", id, delta })), { type: "text-end", id }];
const tool = (id: string, done = true): Chunk[] => [
  { type: "tool-input-start", toolCallId: id, toolName: "net_sales" },
  { type: "tool-input-available", toolCallId: id, toolName: "net_sales", input: {} },
  ...(done ? [{ type: "tool-output-available", toolCallId: id, output: { ok: true } }] : []),
];
const verification = (matched: number, unmatched: number): Chunk => ({
  type: "data-verification",
  data: { attempt: 1, ok: unmatched === 0, matched: Array.from({ length: matched }, (_, i) => ({ id: i })), unmatched: Array.from({ length: unmatched }, (_, i) => ({ text: `${i}`, value: i })) },
});
const sse = (chunks: Chunk[]) => [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
const reply = (chunks: Chunk[], status = 200) => new Response(sse(chunks), { status, headers: { "content-type": "text/event-stream" } });
const fakeFetch = (respond: (init: RequestInit) => Response | Promise<Response>) => vi.fn(async (_url: unknown, init?: RequestInit) => respond(init ?? {})) as unknown as typeof fetch;

const answer: Chunk[] = [
  { type: "start" },
  { type: "data-thread", data: { id: THREAD, title: "t" } },
  { type: "start-step" },
  ...text("pre", "Let me check."),
  ...tool("c1"),
  { type: "finish-step" },
  { type: "start-step" },
  ...text("a1", "Net sales were ", "**$1,204.50**."),
  { type: "finish-step" },
  verification(1, 0),
  { type: "data-provenance", data: [] },
  { type: "finish" },
];

describe("runAsk", () => {
  it("posts only the question, to the chat route, and streams the final answer", async () => {
    const seen: { url: unknown; body: unknown }[] = [];
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init?.body)) });
      return reply(answer);
    }) as unknown as typeof fetch;
    const updates: AnswerView[] = [];
    const final = await runAsk({ question: "How were sales?", signal: new AbortController().signal, onUpdate: (v) => updates.push(v), fetch: f });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/chat");
    expect(seen[0]!.body).toEqual({ messages: [{ id: "search-window-question", role: "user", parts: [{ type: "text", text: "How were sales?" }] }] });
    expect(final).toEqual({ text: "Net sales were **$1,204.50**.", phase: "writing", check: { ok: true, traced: 1, total: 1 }, threadId: THREAD });
    // The text grows in steps. The line written before the lookup is not part of the answer once the lookup has started.
    expect(updates.length).toBeGreaterThan(3);
    expect(updates.some((v) => v.text === "Net sales were ")).toBe(true);
    expect(updates.some((v) => v.phase === "reading")).toBe(true);
    expect(updates.filter((v) => v.phase === "reading").every((v) => v.text === "")).toBe(true);
    expect(updates.every((v) => v.text !== "Let me check." || v.phase === "writing")).toBe(true);
  });

  it("sends no brand, store or user in the request", async () => {
    let body = "";
    const f = fakeFetch((init) => {
      body = String(init.body);
      return reply(answer);
    });
    await runAsk({ question: "q", signal: new AbortController().signal, onUpdate: () => undefined, fetch: f });
    expect(Object.keys(JSON.parse(body))).toEqual(["messages"]);
    expect(body).not.toMatch(/tenant|org|shop|user_|modelId|threadId/i);
  });

  it("throws the server's error code when the route refuses the request", async () => {
    const f = fakeFetch(() => new Response("FORBIDDEN", { status: 403 }));
    const error = await runAsk({ question: "q", signal: new AbortController().signal, onUpdate: () => undefined, fetch: f }).catch((e: unknown) => e);
    expect(problemCode(error)).toBe("FORBIDDEN");
  });

  it("throws an error code that arrives inside the stream, after the partial text was reported", async () => {
    const f = fakeFetch(() => reply([{ type: "start" }, ...text("a1", "Half an answ"), { type: "error", errorText: "BUDGET_EXCEEDED" }, { type: "finish" }]));
    const updates: AnswerView[] = [];
    const error = await runAsk({ question: "q", signal: new AbortController().signal, onUpdate: (v) => updates.push(v), fetch: f }).catch((e: unknown) => e);
    expect(problemCode(error)).toBe("BUDGET_EXCEEDED");
    expect(updates.at(-1)?.text).toBe("Half an answ");
  });

  it("reports a network failure as one", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const error = await runAsk({ question: "q", signal: new AbortController().signal, onUpdate: () => undefined, fetch: f }).catch((e: unknown) => e);
    expect(problemCode(error)).toBe("NETWORK");
  });

  it("stops when the signal aborts, keeping what had arrived", async () => {
    const abort = new AbortController();
    const f = fakeFetch((init) => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sse([{ type: "start" }, ...text("a1", "Net sales were ")]).replace("data: [DONE]\n\n", "")));
          init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const updates: AnswerView[] = [];
    const done = runAsk({
      question: "q",
      signal: abort.signal,
      onUpdate: (v) => {
        updates.push(v);
        if (v.text === "Net sales were ") abort.abort();
      },
      fetch: f,
    }).catch((e: unknown) => e);
    const result = await done;
    expect(abort.signal.aborted).toBe(true);
    expect(result).toBeInstanceOf(Error);
    expect(updates.at(-1)?.text).toBe("Net sales were ");
  });
});

describe("answerView", () => {
  const message = (parts: unknown[]) => ({ id: "m", role: "assistant", parts }) as unknown as UIMessage;
  const t = (value: string) => ({ type: "text", text: value, state: "done" });
  const calling = { type: "tool-net_sales", toolCallId: "c", state: "input-available", input: {} };
  const called = { ...calling, state: "output-available", output: {} };

  it("is waiting before anything arrives, reading while a lookup runs, writing once the answer text starts", () => {
    expect(answerView(message([])).phase).toBe("waiting");
    expect(answerView(message([t("Let me check.")])).phase).toBe("writing"); // text before any lookup counts as the answer so far
    expect(answerView(message([t("Let me check."), calling]))).toMatchObject({ phase: "reading", text: "" });
    expect(answerView(message([t("Let me check."), called]))).toMatchObject({ phase: "waiting", text: "" });
    expect(answerView(message([t("Let me check."), called, t("Sales were $5.")]))).toMatchObject({ phase: "writing", text: "Sales were $5." });
  });

  it("leaves out a first draft that was replaced", () => {
    const view = answerView(message([t("Draft: $9."), { type: "data-verification", data: { ok: false, matched: [], unmatched: [{ text: "$9", value: 9 }] } }, { type: "data-repair", data: { unmatched: ["$9"] } }, t("Corrected: $5.")]));
    expect(view.text).toBe("Corrected: $5.");
    expect(view.check).toBeUndefined(); // the draft's check is not about the corrected text
  });

  it("counts the check that follows the final text", () => {
    const view = answerView(message([t("Sales were $5 and $6."), { type: "data-verification", data: { ok: false, matched: [{}], unmatched: [{}] } }]));
    expect(view.check).toEqual({ ok: false, traced: 1, total: 2 });
  });

  it("reads the saved conversation's id, and ignores one that is not a string", () => {
    expect(answerView(message([{ type: "data-thread", data: { id: THREAD } }])).threadId).toBe(THREAD);
    expect(answerView(message([{ type: "data-thread", data: { id: 7 } }])).threadId).toBeUndefined();
  });
});

describe("askReducer", () => {
  const view = (value: string): AnswerView => ({ text: value, phase: "writing" });
  const ASKED = "2026-11-02T10:00:00.000Z";
  const asking = askReducer(IDLE, { type: "start", question: "Q?", at: ASKED });

  it("moves from asking to done with the final text", () => {
    const mid = askReducer(asking, { type: "update", view: view("Part") });
    expect(mid).toMatchObject({ status: "asking", view: { text: "Part" } });
    expect(askReducer(mid, { type: "finish", view: view("Part and the rest") })).toMatchObject({ status: "done", question: "Q?", askedAt: ASKED, view: { text: "Part and the rest" } });
  });

  it("asks only once: a second start while asking changes nothing", () => {
    const mid = askReducer(asking, { type: "update", view: view("Part") });
    expect(askReducer(mid, { type: "start", question: "Another?", at: ASKED })).toBe(mid);
  });

  it("keeps the partial text when stopped or failed, and ignores late updates after that", () => {
    const mid = askReducer(asking, { type: "update", view: view("Part") });
    const stopped = askReducer(mid, { type: "stop" });
    expect(stopped).toMatchObject({ status: "stopped", view: { text: "Part" } });
    expect(askReducer(stopped, { type: "update", view: view("Later") })).toBe(stopped);
    expect(askReducer(mid, { type: "fail", code: "MODEL_TIMEOUT" })).toMatchObject({ status: "failed", code: "MODEL_TIMEOUT", view: { text: "Part" } });
  });

  it("resets to idle so a new question can start", () => {
    expect(askReducer(askReducer(asking, { type: "stop" }), { type: "reset" })).toBe(IDLE);
    expect(askReducer(IDLE, { type: "start", question: "Q?", at: ASKED }).status).toBe("asking");
  });

  it("only lets a finished answer with text be pinned", () => {
    const done = askReducer(asking, { type: "finish", view: view("Answer") });
    expect(canPin(done)).toBe(true);
    expect(canPin(askReducer(asking, { type: "finish", view: view("  ") }))).toBe(false);
    expect(canPin(asking)).toBe(false);
    expect(canPin(askReducer(asking, { type: "stop" }))).toBe(false);
    expect(canPin(IDLE as AskState)).toBe(false);
  });
});

describe("problemCode", () => {
  it("keeps the server's code and hides everything else", () => {
    expect(problemCode(new Error("BUDGET_EXCEEDED"))).toBe("BUDGET_EXCEEDED");
    expect(problemCode(new Error(" FORBIDDEN\n"))).toBe("FORBIDDEN");
    expect(problemCode(new Error("<html>Sign in</html>"))).toBe("INTERNAL_ERROR");
    expect(problemCode(new Error("AccessDeniedException: not allowed to invoke model"))).toBe("INTERNAL_ERROR");
    expect(problemCode(new TypeError("Failed to fetch"))).toBe("NETWORK");
    expect(problemCode("nope")).toBe("INTERNAL_ERROR");
  });
});

describe("asking from the search box", () => {
  it("treats a question mark or four words as a question", () => {
    expect(looksLikeQuestion("net sales?")).toBe(true);
    expect(looksLikeQuestion("net sales last month")).toBe(true);
    expect(looksLikeQuestion("pace")).toBe(false);
    expect(looksLikeQuestion("net sales")).toBe(false);
  });

  it("offers the typed question first when it looks like one, and as the only row when nothing else matches", () => {
    expect(askRowPlacement("", 5)).toBe("none");
    expect(askRowPlacement("   ", 0)).toBe("none");
    expect(askRowPlacement("pace", 1)).toBe("none");
    expect(askRowPlacement("settngs", 0)).toBe("none"); // one word that matches nothing: a typo, not a question
    expect(askRowPlacement("gift cards", 0)).toBe("only");
    expect(askRowPlacement("sales?", 0)).toBe("only");
    expect(askRowPlacement("how did we do?", 2)).toBe("first");
  });
});
