import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Journal } from "./journal.js";

const meta = { store: "solenne" as const, shop: "solenne-test.myshopify.com" };
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "journal-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("Journal", () => {
  it("marks a record in flight and then done, and a reopened journal remembers both", () => {
    const path = join(dir, "solenne.json");
    const j = Journal.open(path, meta);
    j.markInflight("order", "O_00001");
    expect(Journal.open(path, meta).get("order", "O_00001")?.status).toBe("inflight");
    j.markDone("order", "O_00001", "gid://shopify/Order/1", { lineItems: { V_001: "gid://shopify/LineItem/9" } });
    const reopened = Journal.open(path, meta).get("order", "O_00001");
    expect(reopened).toMatchObject({ status: "done", shopifyId: "gid://shopify/Order/1" });
    expect(reopened?.data).toEqual({ lineItems: { V_001: "gid://shopify/LineItem/9" } });
  });

  it("keeps kinds apart: an order and a refund with the same id don't clash", () => {
    const j = Journal.open(null, meta);
    j.markDone("order", "X_1", "gid://shopify/Order/1");
    expect(j.get("refund", "X_1")).toBeUndefined();
  });

  it("refuses a journal that was written for a different shop", () => {
    const path = join(dir, "solenne.json");
    Journal.open(path, meta).markDone("order", "O_00001", "gid://shopify/Order/1");
    expect(() => Journal.open(path, { ...meta, shop: "other.myshopify.com" })).toThrow(/different shop/);
  });

  it("counts done records per kind", () => {
    const j = Journal.open(null, meta);
    j.markDone("order", "O_1", "a");
    j.markDone("order", "O_2", "b");
    j.markInflight("order", "O_3");
    expect(j.countDone("order")).toBe(2);
  });
});
