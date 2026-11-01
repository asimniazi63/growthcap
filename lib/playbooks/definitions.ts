import { AppError } from "../errors";

// The saved playbooks (T18). A playbook is a fixed sequence of tool calls plus a write-up template, run through the shared agent
// loop so the number checker runs on the result. The question each one sends is written here by the server: nothing in a request
// or in store data reaches it except the validated parameters below.

export const PLAYBOOK_IDS = ["bfcm-review", "retention-check", "monthly-review"] as const;
export type PlaybookId = (typeof PLAYBOOK_IDS)[number];

export interface PlaybookInfo {
  id: PlaybookId;
  title: string;
  description: string; // shown on the page: what it looks at, in plain words
  takesMonth: boolean; // only the monthly review takes a month
}

export const PLAYBOOKS: readonly PlaybookInfo[] = [
  { id: "bfcm-review", title: "Black Friday review", description: "How the last Black Friday to Cyber Monday weekend went, which codes drove it, and which products are most at risk of running out before the next one.", takesMonth: false },
  { id: "retention-check", title: "Retention check", description: "How many customers come back: the repeat rate by first-order month, and how the share of returning customers moved against the previous 30 days.", takesMonth: false },
  { id: "monthly-review", title: "Monthly business review", description: "A finished month against plan: the main numbers, what drove the gap, and the cause with its source.", takesMonth: true },
];

export const isPlaybookId = (v: unknown): v is PlaybookId => typeof v === "string" && (PLAYBOOK_IDS as readonly string[]).includes(v);

// The inputs a run may take. `month` is YYYY-MM and only the monthly review uses it; without one it reviews the last month.
export interface PlaybookParams {
  month?: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Validates what a request may pass. Anything else is refused, so no free text reaches the question.
export function parseParams(id: PlaybookId, raw: unknown): PlaybookParams {
  const input = raw === undefined || raw === null ? {} : raw;
  if (typeof input !== "object" || Array.isArray(input)) throw new AppError("INVALID_INPUT", "The playbook inputs are not valid.");
  const keys = Object.keys(input);
  const info = PLAYBOOKS.find((p) => p.id === id);
  if (!info) throw new AppError("INVALID_INPUT", "Unknown playbook.");
  const month = (input as { month?: unknown }).month;
  if (keys.some((k) => k !== "month") || (keys.includes("month") && month !== undefined && !info.takesMonth)) throw new AppError("INVALID_INPUT", "The playbook inputs are not valid.");
  if (month === undefined) return {};
  if (typeof month !== "string" || !MONTH.test(month)) throw new AppError("INVALID_INPUT", "month must look like 2026-10.");
  return { month };
}

// IMPLEMENTED BY THE CORE AGENT: the fixed question for a playbook run. `now` is the injected clock (the BFCM review picks the
// latest Black Friday weekend that has finished by then).
export { playbookQuestion } from "./questions";
