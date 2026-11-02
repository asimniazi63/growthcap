import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AnswerView } from "@/lib/shell/palette-ask";
import { copyFor, PaletteAnswer, type AnswerState } from "./palette-answer";

const THREAD = "6f1c1c3e-2f7e-4b8a-9d3c-0a1b2c3d4e5f";
const noop = () => undefined;
const base = { question: "How did net sales do?", askedAt: "2026-11-02T10:00:00.000Z" };
const render = (state: AnswerState, pinProblem: string | null = null) => renderToStaticMarkup(<PaletteAnswer state={state} pinProblem={pinProblem} onPin={noop} onStop={noop} onBack={noop} onRetry={noop} onOpenChat={noop} />);
const view = (over: Partial<AnswerView> = {}): AnswerView => ({ text: "", phase: "waiting", ...over });

describe("PaletteAnswer while the answer is coming in", () => {
  it("says the question costs AI budget, offers Esc to stop, and shows no actions yet", () => {
    const out = render({ status: "asking", ...base, view: view() });
    expect(out).toContain("uses this brand&#x27;s AI budget");
    expect(out).toMatch(/<kbd[^>]*>Esc<\/kbd> to stop/);
    expect(out).toMatch(/<button[^>]*>Stop<\/button>/); // a button as well, for touch screens and the mouse
    expect(out).toContain("Thinking…");
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain("skeleton");
    expect(out).not.toContain("Pin to Overview");
    expect(out).not.toContain("Open in Chat");
  });

  it("names what it is doing in each phase, and keeps the text so far", () => {
    expect(render({ status: "asking", ...base, view: view({ phase: "reading" }) })).toContain("Reading the store&#x27;s data…");
    const out = render({ status: "asking", ...base, view: view({ phase: "writing", text: "Net sales were **$1,204.50** so" }) });
    expect(out).toContain("Writing the answer…");
    expect(out).toContain("<strong>$1,204.50</strong>");
    expect(out).not.toContain("skeleton");
  });

  it("announces the phase politely without announcing every streamed word", () => {
    const out = render({ status: "asking", ...base, view: view({ phase: "reading", text: "" }) });
    expect(out).toContain('<p role="status" class="sr-only">Asking the assistant. Reading the store&#x27;s data…</p>');
  });
});

describe("PaletteAnswer once it is done", () => {
  const done = (over: Partial<AnswerView> = {}): AnswerState => ({ status: "done", ...base, view: view({ phase: "writing", text: "Net sales were **$1,204.50**.", ...over }) });

  it("offers Pin to Overview and Open in Chat, and Ask something else", () => {
    const out = render(done());
    expect(out).toContain("Pin to Overview");
    expect(out).toMatch(/<a [^>]*href="\/chat"[^>]*>.*Open in Chat/);
    expect(out).toContain("Ask something else");
    expect(out).toContain('aria-busy="false"');
    expect(out).toContain("The answer is ready.");
  });

  it("says how well the figures were traced, in words with an icon, and that it was saved in Chat", () => {
    const out = render(done({ check: { ok: true, traced: 2, total: 2 }, threadId: THREAD }));
    expect(out).toContain("All 2 figures were traced to the store&#x27;s data");
    expect(out).toContain("Saved in Chat");
    const warned = render(done({ check: { ok: false, traced: 1, total: 2 } }));
    expect(warned).toContain("1 of 2 figures traced to the store&#x27;s data");
    expect(render(done())).not.toContain("traced to the store");
  });

  it("shows why a pin did not work", () => {
    const out = render(done(), "Couldn't pin: this browser's storage is full or blocked.");
    expect(out).toMatch(/<p role="alert"[^>]*>Couldn&#x27;t pin: this browser&#x27;s storage is full or blocked\./);
  });

  it("draws the answer as text only: raw HTML, images and script links do not become elements", () => {
    const out = render(done({ text: 'Hello <img src=x onerror=alert(1)> <script>alert(2)</script> [click](javascript:alert(3)) ![pixel](https://evil.example/p.png) [chat](/chat)' }));
    expect(out).not.toMatch(/<img\b/);
    expect(out).not.toMatch(/<script\b/);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("evil.example");
    expect(out).toContain('href="/chat"');
  });
});

describe("PaletteAnswer when stopped or failed", () => {
  it("says a stopped answer is partial, keeps the text, and cannot be pinned", () => {
    const out = render({ status: "stopped", ...base, view: view({ phase: "writing", text: "Net sales were" }) });
    expect(out).toContain("Net sales were");
    expect(out).toContain("Stopped. The assistant may still finish");
    expect(out).not.toContain("Pin to Overview");
    expect(out).toContain("Ask something else");
  });

  it("gives a plain message and a retry for a failure that can be retried", () => {
    const out = render({ status: "failed", ...base, view: view(), code: "MODEL_TIMEOUT" });
    expect(out).toContain("The assistant took too long");
    expect(out).toContain("Try again");
    expect(out).toMatch(/role="alert"/);
    expect(out).not.toContain("Pin to Overview");
  });

  it("gives no retry for a failure that waiting will not fix, and never shows a provider message", () => {
    const budget = render({ status: "failed", ...base, view: view(), code: "BUDGET_EXCEEDED" });
    expect(budget).toContain("AI budget is used up");
    expect(budget).not.toContain("Try again");
    const unknown = render({ status: "failed", ...base, view: view(), code: "AccessDeniedException: arn:aws:bedrock:secret" });
    expect(unknown).toContain("Something went wrong on our side");
    expect(unknown).not.toContain("arn:aws");
  });
});

describe("copyFor", () => {
  it("covers the codes the window adds, the chat's codes, and falls back for anything else", () => {
    expect(copyFor("NETWORK").title).toBe("Can't reach the server");
    expect(copyFor("EMPTY").title).toBe("No answer came back");
    expect(copyFor("FORBIDDEN").title).toContain("access");
    expect(copyFor("whatever").title).toBe(copyFor("INTERNAL_ERROR").title);
  });
});
