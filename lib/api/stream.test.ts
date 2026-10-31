import { describe, expect, it } from "vitest";
import { detach } from "./stream";

const slowStream = (chunks: number[], seen: number[]) =>
  new ReadableStream<number>({
    async pull(controller) {
      const next = chunks.shift();
      if (next === undefined) return controller.close();
      await new Promise((r) => setTimeout(r, 5));
      seen.push(next);
      controller.enqueue(next);
    },
  });

describe("detach", () => {
  it("lets the browser read everything", async () => {
    const seen: number[] = [];
    const { client, finished } = detach(slowStream([1, 2, 3], seen));
    const got: number[] = [];
    const reader = client.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got.push(value);
    }
    await finished;
    expect(got).toEqual([1, 2, 3]);
  });

  it("keeps the work going to the end when the browser goes away after the first chunk", async () => {
    const seen: number[] = [];
    const { client, finished } = detach(slowStream([1, 2, 3, 4], seen));
    const reader = client.getReader();
    await reader.read();
    await reader.cancel(); // the tab is closed
    await finished;
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it("settles even if the source stream errors", async () => {
    const { client, finished } = detach(new ReadableStream<number>({ start: (c) => c.error(new Error("boom")) }));
    await expect(finished).resolves.toBeUndefined();
    await expect(client.getReader().read()).rejects.toThrow("boom");
  });
});
