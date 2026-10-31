import { describe, expect, it } from "vitest";
import { AppError } from "../errors";
import { NotAllowedError } from "../memory/store";
import type { TenantContext } from "../tenancy/context";
import { errorResponse, readJson, withTenant } from "./respond";

const ctx: TenantContext = { tenantId: "t", orgId: "o", userId: "u", role: "gc_admin", shop: null };
const body = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe("withTenant", () => {
  it("answers 403 without running the handler when there is no usable session", async () => {
    let ran = false;
    const res = await withTenant(async () => ((ran = true), Response.json({})), async () => {
      throw new Error("no session");
    });
    expect(res.status).toBe(403);
    expect(await body(res)).toEqual({ error: "FORBIDDEN" });
    expect(ran).toBe(false);
  });

  it("hands the handler the session's tenant and person", async () => {
    const res = await withTenant(async (c) => Response.json({ tenant: c.tenantId, user: c.userId }), async () => ctx);
    expect(await body(res)).toEqual({ tenant: "t", user: "u" });
  });

  it("turns what the handler throws into a response", async () => {
    const res = await withTenant(async () => {
      throw new AppError("INVALID_INPUT", "bad");
    }, async () => ctx);
    expect(res.status).toBe(400);
  });
});

describe("errorResponse", () => {
  it("maps a refused role to 403, bad input to 400, no data to 404, and anything unexpected to a generic 500", async () => {
    expect(errorResponse(new NotAllowedError()).status).toBe(403);
    expect(errorResponse(new AppError("INVALID_INPUT", "x")).status).toBe(400);
    expect(errorResponse(new AppError("NO_DATA", "x")).status).toBe(404);
    const boom = errorResponse(new Error("password=hunter2 in the database url"));
    expect(boom.status).toBe(500);
    expect(JSON.stringify(await body(boom))).not.toContain("hunter2");
  });
});

describe("readJson", () => {
  it("reads a JSON body, and refuses one that is not JSON or is too large", async () => {
    expect(await readJson(new Request("http://x", { method: "POST", body: JSON.stringify({ a: 1 }) }))).toEqual({ a: 1 });
    await expect(readJson(new Request("http://x", { method: "POST", body: "not json" }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(readJson(new Request("http://x", { method: "POST", body: "{}", headers: { "content-length": "999999" } }))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
