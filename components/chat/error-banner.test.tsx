import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@/lib/errors";
import { ErrorBanner, ERROR_COPY } from "./error-banner";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
const html = (code: Parameters<typeof ErrorBanner>[0]["code"], role: Parameters<typeof ErrorBanner>[0]["role"] = "gc_admin") =>
  renderToStaticMarkup(<ErrorBanner code={code} role={role} onRetry={() => undefined} />);

describe("ErrorBanner", () => {
  it.each([...ERROR_CODES, "FORBIDDEN"] as const)("%s renders its own copy", (code) => {
    const copy = ERROR_COPY[code];
    expect(copy.title.length).toBeGreaterThan(3);
    const out = html(code);
    expect(out).toContain(escape(copy.title));
    expect(out).toContain('role="alert"');
  });

  it("has distinct copy for every code", () => {
    const titles = Object.values(ERROR_COPY).map((c) => c.title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("gives only a GC admin the reconnect button when the store is disconnected", () => {
    expect(html("STORE_DISCONNECTED", "gc_admin")).toContain('href="/connect"');
    expect(html("STORE_DISCONNECTED", "gc_admin")).toMatch(/Reconnect/);
    for (const role of ["gc_partner", "client_viewer"] as const) {
      const out = html("STORE_DISCONNECTED", role);
      expect(out).not.toContain('href="/connect"');
      expect(out).toContain("Ask your GC admin to reconnect");
    }
  });

  it("offers a retry for a timeout, and not for an exhausted budget", () => {
    expect(html("MODEL_TIMEOUT")).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html("BUDGET_EXCEEDED")).not.toContain("<button");
    expect(html("BUDGET_EXCEEDED")).toContain("midnight UTC");
  });

  it("falls back to the generic message for a code it doesn't know", () => {
    expect(html("SOMETHING_ELSE" as never)).toContain(escape(ERROR_COPY.INTERNAL_ERROR.title));
  });
});
