import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MemoryCard } from "./memory-card";

const html = (props: Partial<Parameters<typeof MemoryCard>[0]> = {}) => renderToStaticMarkup(<MemoryCard id="m1" text="Exclude wholesale from AOV." status="proposed" canDecide {...props} />);

describe("MemoryCard", () => {
  it("shows the note as written, with Confirm and Dismiss for a person who can decide", () => {
    const out = html();
    expect(out).toContain("Exclude wholesale from AOV.");
    expect(out).toContain("Confirm");
    expect(out).toContain("Dismiss");
  });
  it("shows no buttons to someone who can't decide, only that it is waiting", () => {
    const out = html({ canDecide: false });
    expect(out).not.toContain("<button");
    expect(out).toContain("Waiting for a Growth Capital admin or partner");
  });
  it("shows a decided note without buttons", () => {
    expect(html({ status: "confirmed" })).toContain("Confirmed");
    expect(html({ status: "confirmed" })).not.toContain("<button");
    expect(html({ status: "dismissed" })).toContain("Dismissed");
  });
  it("escapes the note, which came from the model", () => {
    const out = html({ text: "<script>alert(1)</script>" });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });
});
