import type { UIMessageChunk } from "ai";

// Reads a finished agent run for a job that stores its write-up (the playbooks). Copied from lib/audit/generate.ts; the audit
// and the brief still keep their own copy, which is a known follow-up.

export interface Verification {
  ok: boolean;
  unmatched: { text: string }[];
}

// The final answer is the text of the last step that wrote any, which is what the checker checked; the last verification is
// the checker's result after the repair turn, if there was one.
export async function readAnswer(stream: ReadableStream<UIMessageChunk>): Promise<{ text: string; verification: Verification | null }> {
  const steps: string[] = [];
  let verification: Verification | null = null;
  const reader = stream.getReader();
  for (;;) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    if (chunk.type === "start-step") steps.push("");
    else if (chunk.type === "text-delta") {
      if (steps.length === 0) steps.push("");
      steps[steps.length - 1] += chunk.delta;
    } else if (chunk.type === "data-verification") verification = (chunk as unknown as { data: Verification }).data;
  }
  return { text: steps.filter((s) => s.trim()).at(-1)?.trim() ?? "", verification };
}
