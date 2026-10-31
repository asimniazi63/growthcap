import { describe, expect, it } from "vitest";
import { ACTION_KINDS } from "../types";
import { getExecutor } from "../registry";

describe("executors/index", () => {
  it("registers an executor for every action kind", async () => {
    await import("./index");
    for (const kind of ACTION_KINDS) expect((await getExecutor(kind)).kind).toBe(kind);
  });
});
