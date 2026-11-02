import { describe, expect, it } from "vitest";
import { readRaw, writeRaw, type StoreLike } from "@/lib/shell/local-store";
import { addPin, askAgainHref, checkLine, formatAsked, isLongAnswer, MAX_PINS, newPinId, parsePins, pinsKey, removePin, type PinnedAnswer } from "./pinned-answers";

const pin = (n: number, over: Partial<PinnedAnswer> = {}): PinnedAnswer => ({ id: `id-${n}`, question: `Question ${n}?`, answer: `Answer ${n}`, askedAt: `2026-11-0${(n % 9) + 1}T10:00:00.000Z`, ...over });

describe("addPin", () => {
  it("puts the newest pin first", () => {
    expect(addPin([pin(1)], pin(2)).map((p) => p.id)).toEqual(["id-2", "id-1"]);
  });

  it("keeps at most six, dropping the oldest", () => {
    let list: PinnedAnswer[] = [];
    for (let i = 1; i <= MAX_PINS + 2; i++) list = addPin(list, pin(i));
    expect(list).toHaveLength(MAX_PINS);
    expect(list.map((p) => p.id)).toEqual(["id-8", "id-7", "id-6", "id-5", "id-4", "id-3"]);
  });

  it("replaces an earlier pin of the same question and answer instead of listing it twice", () => {
    const again = pin(9, { question: "Question 1?", answer: "Answer 1" });
    expect(addPin([pin(2), pin(1)], again).map((p) => p.id)).toEqual(["id-9", "id-2"]);
  });

  it("keeps two answers to the same question when they differ, because each is a snapshot", () => {
    const later = pin(9, { question: "Question 1?", answer: "A different answer" });
    expect(addPin([pin(1)], later)).toHaveLength(2);
  });

  it("does not change the list it was given", () => {
    const list = [pin(1)];
    addPin(list, pin(2));
    expect(list).toHaveLength(1);
  });
});

describe("removePin", () => {
  it("removes one pin by id", () => {
    expect(removePin([pin(1), pin(2)], "id-1").map((p) => p.id)).toEqual(["id-2"]);
    expect(removePin([pin(1)], "missing")).toHaveLength(1);
  });
});

describe("parsePins", () => {
  it("reads back what was stored, text exactly as it was", () => {
    const stored = [pin(1, { answer: "Net sales were **$1,204.50**.\n\n- one\n- two", check: { ok: true, traced: 1, total: 1 }, threadId: "6f1c1c3e-2f7e-4b8a-9d3c-0a1b2c3d4e5f" })];
    expect(parsePins(JSON.stringify(stored))).toEqual(stored);
  });

  it("gives an empty list for nothing, damage or the wrong shape", () => {
    expect(parsePins(null)).toEqual([]);
    expect(parsePins("")).toEqual([]);
    expect(parsePins("{not json")).toEqual([]);
    expect(parsePins('{"id":"x"}')).toEqual([]);
    expect(parsePins("42")).toEqual([]);
  });

  it("drops entries that are not whole, and keeps the good ones", () => {
    const raw = JSON.stringify([pin(1), { id: "x" }, null, "text", pin(2, { askedAt: "not a date" }), { ...pin(3), question: "  " }, pin(4)]);
    expect(parsePins(raw).map((p) => p.id)).toEqual(["id-1", "id-4"]);
  });

  it("ignores a malformed check or thread id rather than trusting it", () => {
    const [p] = parsePins(JSON.stringify([{ ...pin(1), check: { ok: "yes", traced: -1, total: 2 }, threadId: "../../etc" }]));
    expect(p).toEqual(pin(1));
  });

  it("cuts a longer list than the cap", () => {
    const many = Array.from({ length: 20 }, (_, i) => pin(i + 1));
    expect(parsePins(JSON.stringify(many))).toHaveLength(MAX_PINS);
  });
});

describe("storage that is blocked or full", () => {
  const throwing: StoreLike = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };

  it("reads as an empty list and reports that a write was not kept", () => {
    expect(parsePins(readRaw(throwing, "k"))).toEqual([]);
    expect(writeRaw(throwing, "k", "[]")).toBe(false);
    expect(readRaw(null, "k")).toBeNull();
    expect(writeRaw(null, "k", "[]")).toBe(false);
  });

  it("round-trips through a working store and removes with null", () => {
    const map = new Map<string, string>();
    const store: StoreLike = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
    const key = pinsKey("org_1", "user_1");
    expect(writeRaw(store, key, JSON.stringify(addPin([], pin(1))))).toBe(true);
    expect(parsePins(readRaw(store, key))).toEqual([pin(1)]);
    expect(writeRaw(store, key, null)).toBe(true);
    expect(readRaw(store, key)).toBeNull();
  });
});

describe("pinsKey", () => {
  it("is different for each brand and each person", () => {
    expect(pinsKey("org_a", "user_1")).not.toBe(pinsKey("org_b", "user_1"));
    expect(pinsKey("org_a", "user_1")).not.toBe(pinsKey("org_a", "user_2"));
  });
});

describe("formatAsked", () => {
  it("gives the day and time in the given zone", () => {
    expect(formatAsked("2026-11-02T14:32:00.000Z", { locale: "en-GB", timeZone: "UTC" })).toBe("2 Nov, 14:32");
    expect(formatAsked("2026-11-02T14:32:00.000Z", { locale: "en-GB", timeZone: "America/New_York" })).toBe("2 Nov, 09:32");
  });

  it("is empty for a date that cannot be read", () => {
    expect(formatAsked("nonsense")).toBe("");
  });
});

describe("askAgainHref and checkLine", () => {
  it("asks again through Chat, with the question encoded", () => {
    expect(askAgainHref("Sales & stock?")).toBe("/chat?q=Sales%20%26%20stock%3F");
  });

  it("describes the check in words, and says nothing when there was nothing to check", () => {
    expect(checkLine(undefined)).toBeNull();
    expect(checkLine({ ok: true, traced: 0, total: 0 })).toBeNull();
    expect(checkLine({ ok: true, traced: 4, total: 4 })).toEqual({ ok: true, text: "All 4 figures were traced to the store's data" });
    expect(checkLine({ ok: true, traced: 1, total: 1 })).toEqual({ ok: true, text: "The figure was traced to the store's data" });
    expect(checkLine({ ok: false, traced: 3, total: 4 })).toEqual({ ok: false, text: "3 of 4 figures traced to the store's data" });
  });
});

describe("newPinId", () => {
  it("gives a different id each time", () => {
    expect(newPinId()).not.toBe(newPinId());
    expect(newPinId().length).toBeGreaterThan(8);
  });
});

describe("isLongAnswer", () => {
  it("cuts only answers that are long in characters or in lines", () => {
    expect(isLongAnswer("Net sales were $1,204.50.")).toBe(false);
    expect(isLongAnswer("x".repeat(361))).toBe(true);
    expect(isLongAnswer(Array.from({ length: 8 }, (_, i) => `- line ${i}`).join("\n"))).toBe(true);
    expect(isLongAnswer(Array.from({ length: 7 }, (_, i) => `- line ${i}`).join("\n"))).toBe(false);
  });
});
