import { describe, expect, it } from "vitest";
import { readLimitedForm } from "./body";

const form = (bytes: number) => {
  const f = new FormData();
  f.set("kind", "sow");
  f.set("file", new File([new Uint8Array(bytes)], "a.pdf"));
  return f;
};
const post = (body: BodyInit, headers: Record<string, string> = {}) => new Request("http://x/api/documents", { method: "POST", body, headers });

describe("readLimitedForm", () => {
  it("reads a small form", async () => {
    const got = await readLimitedForm(post(form(1000)), 4096);
    expect(got.get("kind")).toBe("sow");
    expect((got.get("file") as File).size).toBe(1000);
  });

  it("refuses by the declared length without reading, and by the real size when no length is declared or it lies", async () => {
    const big = post(form(10_000));
    const type = big.headers.get("content-type")!;
    await expect(readLimitedForm(post("x", { "content-type": type, "content-length": "99999999" }), 4096)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const encoded = await new Response(form(100_000)).arrayBuffer();
    const stream = new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(new Uint8Array(encoded)), c.close()) });
    const chunked = new Request("http://x", { method: "POST", body: stream, headers: { "content-type": type, "content-length": "10" }, duplex: "half" } as RequestInit);
    await expect(readLimitedForm(chunked, 4096)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses anything that isn't a multipart form", async () => {
    await expect(readLimitedForm(post("{}", { "content-type": "application/json" }), 4096)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
