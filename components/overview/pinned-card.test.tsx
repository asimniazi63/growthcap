import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PinnedAnswer } from "@/lib/overview/pinned-answers";
import { PinnedAnswers } from "./pinned-answers";
import { PinnedCard } from "./pinned-card";

const THREAD = "6f1c1c3e-2f7e-4b8a-9d3c-0a1b2c3d4e5f";
const pin = (over: Partial<PinnedAnswer> = {}): PinnedAnswer => ({ id: "p1", question: "How did net sales do last month?", answer: "Net sales were **$1,204.50**, up from **$980.00**.", askedAt: "2026-11-02T14:32:00.000Z", ...over });
const render = (p: PinnedAnswer, fresh = false) => renderToStaticMarkup(<PinnedCard pin={p} fresh={fresh} onUnpin={() => undefined} />);

describe("PinnedCard", () => {
  it("shows the question as the title, the answer as it was, and when it was asked", () => {
    const out = render(pin());
    expect(out).toMatch(/<h3[^>]*>How did net sales do last month\?<\/h3>/);
    expect(out).toContain("<strong>$1,204.50</strong>");
    expect(out).toMatch(/Asked <time dateTime="2026-11-02T14:32:00.000Z">[^<]*\d[^<]*<\/time>/);
  });

  it("has an unpin button that names the question, and an Ask again link that asks it in Chat", () => {
    const out = render(pin({ question: "Who are my top customers?" }));
    expect(out).toContain('aria-label="Unpin: Who are my top customers?"');
    expect(out).toMatch(/href="\/chat\?q=Who%20are%20my%20top%20customers%3F"[^>]*>Ask again/);
  });

  it("says in words how the figures were traced, when the server checked them", () => {
    expect(render(pin({ check: { ok: true, traced: 2, total: 2 } }))).toContain("All 2 figures were traced to the store&#x27;s data");
    expect(render(pin({ check: { ok: false, traced: 1, total: 2 } }))).toContain("1 of 2 figures traced to the store&#x27;s data");
    expect(render(pin())).not.toContain("traced to the store");
  });

  it("settles in only when the card has just landed, and only for people who allow motion", () => {
    expect(render(pin(), true)).toContain("motion-safe:animate-[toast-in_0.32s_ease-out]");
    expect(render(pin(), false)).not.toContain("animate-");
  });

  it("shows a short answer in full without a toggle", () => {
    const out = render(pin());
    expect(out).not.toContain("aria-expanded");
    expect(out).not.toContain("overflow-hidden");
  });

  it("cuts a long answer and offers to show all of it", () => {
    const out = render(pin({ answer: Array.from({ length: 12 }, (_, i) => `- Product ${i + 1}: ${100 - i} units`).join("\n") }));
    expect(out).toContain("max-h-40 overflow-hidden");
    expect(out).toMatch(/aria-expanded="false"[^>]*aria-controls="[^"]+"/);
    expect(out).toContain("Show all");
    expect(out).toContain("Product 12");
  });

  it("draws the question and answer as text: no HTML elements, images or script links come out of them", () => {
    const out = render(pin({ question: '<img src=x onerror=alert(1)>What sold?', answer: '<script>alert(1)</script>\n\n[open](javascript:alert(2)) ![x](https://evil.example/p.png) <b onclick="x()">bold</b>' }));
    expect(out).not.toMatch(/<img\b/);
    expect(out).not.toMatch(/<script\b/);
    expect(out).not.toMatch(/<b\b/);
    expect(out).not.toMatch(/<a [^>]*javascript:/);
    expect(out).not.toMatch(/(?:src|href)="[^"]*evil\.example/);
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;What sold?");
  });

  it("keeps the saved conversation id out of the markup", () => {
    expect(render(pin({ threadId: THREAD }))).not.toContain(THREAD);
  });
});

describe("PinnedAnswers", () => {
  it("renders nothing visible on the server, where there is no browser storage to read", () => {
    const out = renderToStaticMarkup(<PinnedAnswers orgId="org_1" userId="user_1" />);
    expect(out).not.toContain("Pinned answers");
    expect(out).not.toContain("<article");
    expect(out).toContain('role="status"');
  });
});
