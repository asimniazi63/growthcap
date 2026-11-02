// Answers a person pinned from the search window to the Overview page. They live in this browser only (localStorage), one list
// per brand and per person, and are a snapshot: the text is stored exactly as it arrived, and the card says when it was asked.

export const MAX_PINS = 6;

// How well the answer's figures were traced to the store's data when it was asked (the server's check; nothing is worked out here).
export interface AnswerCheck {
  ok: boolean;
  traced: number;
  total: number;
}

export interface PinnedAnswer {
  id: string;
  question: string;
  answer: string;
  askedAt: string; // ISO time
  check?: AnswerCheck;
  threadId?: string; // the conversation the question was saved as in Chat
}

// Clerk's organization and user ids: the Overview page reads them from the session, the search window from Clerk's hook, so both build the same key.
export const pinsKey = (orgId: string, userId: string) => `oasis:pins:${orgId}:${userId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function toPin(v: unknown): PinnedAnswer | null {
  if (!isRecord(v)) return null;
  const { id, question, answer, askedAt, check, threadId } = v;
  if (typeof id !== "string" || !id || typeof question !== "string" || !question.trim() || typeof answer !== "string" || typeof askedAt !== "string") return null;
  if (Number.isNaN(Date.parse(askedAt))) return null;
  const pin: PinnedAnswer = { id, question, answer, askedAt };
  if (isRecord(check) && typeof check.ok === "boolean" && count(check.traced) && count(check.total)) pin.check = { ok: check.ok, traced: check.traced, total: check.total };
  if (typeof threadId === "string" && UUID.test(threadId)) pin.threadId = threadId;
  return pin;
}

// Whatever is in storage, read defensively: a hand-edited or older value gives a shorter list, never an error.
export function parsePins(raw: string | null): PinnedAnswer[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((v) => toPin(v) ?? []).slice(0, MAX_PINS);
  } catch {
    return [];
  }
}

// The newest pin goes first and the oldest drops off past the cap. Pinning the same answer to the same question again replaces the earlier pin.
export function addPin(pins: PinnedAnswer[], pin: PinnedAnswer): PinnedAnswer[] {
  const rest = pins.filter((p) => p.id !== pin.id && !(p.question === pin.question && p.answer === pin.answer));
  return [pin, ...rest].slice(0, MAX_PINS);
}

export const removePin = (pins: PinnedAnswer[], id: string): PinnedAnswer[] => pins.filter((p) => p.id !== id);

// "2 Nov, 14:32" in the viewer's own time zone. The time zone and locale can be given so the result is the same in a test.
export function formatAsked(iso: string, options: { locale?: string; timeZone?: string } = {}): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat(options.locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: options.timeZone }).format(at);
}

// Asking again opens Chat, which asks the question once and shows today's figures.
export const askAgainHref = (question: string) => `/chat?q=${encodeURIComponent(question)}`;

// "All 4 figures traced to the store's data" or "3 of 4 figures traced"; nothing when the answer had no figures to check.
export function checkLine(check: AnswerCheck | undefined): { ok: boolean; text: string } | null {
  if (!check || check.total === 0) return null;
  const figures = (n: number) => `${n} ${n === 1 ? "figure" : "figures"}`;
  if (check.ok) return { ok: true, text: `${check.total === 1 ? "The figure was" : `All ${figures(check.total)} were`} traced to the store's data` };
  return { ok: false, text: `${check.traced} of ${figures(check.total)} traced to the store's data` };
}

// An id for a new pin. Browsers only offer randomUUID on secure pages, so a plain page gets a time-and-random id instead.
export function newPinId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// A long answer is shown cut short on its card, with a way to open the rest.
export function isLongAnswer(answer: string): boolean {
  return answer.length > 360 || answer.split("\n").length > 7;
}
