import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { ModelMessage } from "ai";
import type { Db } from "../db/client";
import { threadMessages, tenants } from "../db/schema";
import { createTestDb } from "../db/test-db";
import { REPLAY_TURNS, appendTurn, createThread, deleteThread, listThreads, loadThread, openOrStart } from "./store";

let db: Db;
let a: string;
let b: string;
beforeEach(async () => {
  db = await createTestDb();
  const rows = await db.insert(tenants).values([{ orgId: "org_a", name: "A" }, { orgId: "org_b", name: "B" }]).returning({ id: tenants.id });
  a = rows[0]!.id;
  b = rows[1]!.id;
}, 60_000);

const user = (text: string): ModelMessage => ({ role: "user", content: [{ type: "text", text }] });
const turn = (q: string): ModelMessage[] => [
  user(q),
  { role: "assistant", content: [{ type: "tool-call", toolCallId: `c-${q}`, toolName: "query_metric", input: { metrics: ["orders"] } }] },
  { role: "tool", content: [{ type: "tool-result", toolCallId: `c-${q}`, toolName: "query_metric", output: { type: "json", value: { data: [{ values: { orders: 3 } }] } } }] },
  { role: "assistant", content: [{ type: "text", text: `answer to ${q}` }] },
];

describe("threads", () => {
  it("replays the provider messages exactly as stored, including a reasoning block with its signature", async () => {
    const id = await createThread(db, { tenantId: a, userId: "u1", title: "First" });
    const withThinking: ModelMessage[] = [
      user("why?"),
      { role: "assistant", content: [{ type: "reasoning", text: "", providerOptions: { bedrock: { signature: "sig-abc==", redactedData: "xyz" } } }, { type: "text", text: "Because." }] },
    ];
    await appendTurn(db, { tenantId: a, userId: "u1", threadId: id, ui: [], delta: withThinking });
    const t = await loadThread(db, a, "u1", id);
    expect(t!.history).toEqual(withThinking);
  });

  it("keeps messages in the order they were added, across turns", async () => {
    const id = await createThread(db, { tenantId: a, userId: "u1", title: "T" });
    await appendTurn(db, { tenantId: a, userId: "u1", threadId: id, ui: [{ id: "1" }], delta: turn("one") });
    await appendTurn(db, { tenantId: a, userId: "u1", threadId: id, ui: [{ id: "1" }, { id: "2" }], delta: turn("two") });
    const t = await loadThread(db, a, "u1", id);
    expect(t!.history).toEqual([...turn("one"), ...turn("two")]);
    expect(t!.ui).toEqual([{ id: "1" }, { id: "2" }]); // the latest display copy replaces the earlier one
  });

  it("replays only the most recent turns, and cuts only between turns so a tool call never loses its result", async () => {
    const id = await createThread(db, { tenantId: a, userId: "u1", title: "Long" });
    for (let i = 1; i <= REPLAY_TURNS + 3; i++) await appendTurn(db, { tenantId: a, userId: "u1", threadId: id, ui: [], delta: turn(`q${i}`) });
    const t = await loadThread(db, a, "u1", id);
    expect(t!.history).toHaveLength(REPLAY_TURNS * 4);
    expect(t!.history[0]).toEqual(user("q4"));
    expect(t!.history.at(-1)).toEqual({ role: "assistant", content: [{ type: "text", text: `answer to q${REPLAY_TURNS + 3}` }] });
  });

  it("belongs to one person in one brand: nobody else can load, add to or delete it", async () => {
    const id = await createThread(db, { tenantId: a, userId: "u1", title: "Mine" });
    expect(await loadThread(db, a, "u2", id)).toBeNull();
    expect(await loadThread(db, b, "u1", id)).toBeNull();
    await expect(appendTurn(db, { tenantId: a, userId: "u2", threadId: id, ui: [], delta: turn("x") })).rejects.toThrow(/thread/i);
    await expect(appendTurn(db, { tenantId: b, userId: "u1", threadId: id, ui: [], delta: turn("x") })).rejects.toThrow(/thread/i);
    expect(await deleteThread(db, a, "u2", id)).toBe(false);
    expect(await deleteThread(db, b, "u1", id)).toBe(false);
    expect(await loadThread(db, a, "u1", id)).not.toBeNull();
    expect(await db.select().from(threadMessages).where(eq(threadMessages.threadId, id))).toHaveLength(0);
  });

  it("lists a person's threads, newest activity first, without their messages", async () => {
    const one = await createThread(db, { tenantId: a, userId: "u1", title: "Older" });
    const two = await createThread(db, { tenantId: a, userId: "u1", title: "Newer" });
    await createThread(db, { tenantId: a, userId: "u2", title: "Someone else's" });
    await createThread(db, { tenantId: b, userId: "u1", title: "Another brand's" });
    await appendTurn(db, { tenantId: a, userId: "u1", threadId: one, ui: [], delta: turn("bump") }); // activity moves it to the top
    const list = await listThreads(db, a, "u1");
    expect(list.map((t) => t.id)).toEqual([one, two]);
    expect(Object.keys(list[0]!).sort()).toEqual(["id", "title", "updatedAt"]);
  });

  it("can be created with an id chosen in advance, which the browser holds before the first answer is saved", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(await createThread(db, { id, tenantId: a, userId: "u1", title: "Planned" })).toBe(id);
    expect((await loadThread(db, a, "u1", id))!.title).toBe("Planned");
  });

  it("deletes a thread and its messages", async () => {
    const id = await createThread(db, { tenantId: a, userId: "u1", title: "Bye" });
    await appendTurn(db, { tenantId: a, userId: "u1", threadId: id, ui: [], delta: turn("x") });
    expect(await deleteThread(db, a, "u1", id)).toBe(true);
    expect(await loadThread(db, a, "u1", id)).toBeNull();
    expect(await db.select().from(threadMessages).where(eq(threadMessages.threadId, id))).toHaveLength(0);
  });

  it("makes a title from the first question: one line, trimmed to 60 characters", async () => {
    const id = await createThread(db, { tenantId: a, userId: "u1", title: "  How did\nnet sales do last month compared with the month before, and why was it down so much?  " });
    const [t] = await listThreads(db, a, "u1");
    expect(t!.id).toBe(id);
    expect(t!.title).toBe("How did net sales do last month compared with the month before, and why was it down so much?".slice(0, 59) + "…");
    expect(t!.title.length).toBeLessThanOrEqual(60);
    expect(t!.title).not.toContain("\n");
  });
});

describe("loadThread without history", () => {
  it("returns the conversation as shown, without reading the model's messages", async () => {
    const id = await createThread(db, { tenantId: a, userId: "u1", title: "T" });
    await appendTurn(db, { tenantId: a, userId: "u1", threadId: id, ui: [{ id: "1" }], delta: turn("x") });
    const t = await loadThread(db, a, "u1", id, { history: false });
    expect(t).toMatchObject({ id, ui: [{ id: "1" }], history: [] });
  });
  it("still refuses someone else's thread and a malformed id", async () => {
    const id = await createThread(db, { tenantId: a, userId: "u1", title: "T" });
    expect(await loadThread(db, a, "u2", id, { history: false })).toBeNull();
    expect(await loadThread(db, a, "u1", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { history: false })).toBeNull();
  });
});

describe("openOrStart", () => {
  it("continues the person's own saved thread", async () => {
    const id = await createThread(db, { tenantId: a, userId: "u1", title: "Mine" });
    await appendTurn(db, { tenantId: a, userId: "u1", threadId: id, ui: [], delta: turn("x") });
    const t = await openOrStart(db, { tenantId: a, userId: "u1", threadId: id, firstQuestion: "ignored" });
    expect(t).toMatchObject({ id, title: "Mine", isNew: false });
    expect(t.history).toEqual(turn("x"));
  });
  it("starts a new thread with a fresh id when the id was never saved, was deleted, or isn't theirs", async () => {
    const theirs = await createThread(db, { tenantId: a, userId: "u1", title: "Theirs" });
    const unsaved = "44444444-4444-4444-8444-444444444444";
    for (const [userId, threadId] of [["u1", unsaved], ["u2", theirs], ["u1", "not-a-uuid"], ["u1", undefined]] as const) {
      const t = await openOrStart(db, { tenantId: a, userId, threadId, firstQuestion: "How is the shop doing?" });
      expect(t).toMatchObject({ isNew: true, title: "How is the shop doing?", history: [], ui: [] });
      expect(t.id).not.toBe(threadId);
      expect(t.id).not.toBe(theirs);
    }
  });
});
