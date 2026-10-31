import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../lib/db/client";
import { tenants } from "../lib/db/schema";
import { createTestDb } from "../lib/db/test-db";
import { createTenant, fetchOrgName, runCli } from "./tenant-create";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

describe("createTenant", () => {
  it("creates the tenants row, naming it from the Clerk lookup when no name is given", async () => {
    const lookups: string[] = [];
    const result = await createTenant({ db, orgId: "org_abc", lookupName: async (id) => (lookups.push(id), "Solenne") });
    expect(result).toMatchObject({ created: true, name: "Solenne" });
    expect(lookups).toEqual(["org_abc"]);
    expect(await db.select().from(tenants)).toMatchObject([{ orgId: "org_abc", name: "Solenne", id: result.tenantId }]);
  });

  it("uses the name it is given and doesn't ask Clerk", async () => {
    const result = await createTenant({
      db,
      orgId: "org_abc",
      name: "Tidepool Baby",
      lookupName: async () => {
        throw new Error("must not be called");
      },
    });
    expect(result.name).toBe("Tidepool Baby");
  });

  it("is idempotent: an org that already has a row is reported, not duplicated, and Clerk isn't asked", async () => {
    const first = await createTenant({ db, orgId: "org_abc", name: "Solenne" });
    const again = await createTenant({
      db,
      orgId: "org_abc",
      lookupName: async () => {
        throw new Error("must not be called");
      },
    });
    expect(again).toEqual({ created: false, tenantId: first.tenantId, name: "Solenne" });
    expect(await db.select().from(tenants)).toHaveLength(1);
  });

  it("creates nothing when the name lookup fails", async () => {
    await expect(
      createTenant({
        db,
        orgId: "org_abc",
        lookupName: async () => {
          throw new Error("Clerk answered HTTP 404");
        },
      }),
    ).rejects.toThrow(/404/);
    expect(await db.select().from(tenants)).toEqual([]);
  });

  it("needs either a name or a way to look one up", async () => {
    await expect(createTenant({ db, orgId: "org_abc" })).rejects.toThrow(/no name/i);
    expect(await db.select().from(tenants)).toEqual([]);
  });

  it.each(["", "abc", "user_123"])("refuses %j, which is not a Clerk organization id", async (orgId) => {
    await expect(createTenant({ db, orgId, name: "X" })).rejects.toThrow(/org_/);
    expect(await db.select().from(tenants)).toEqual([]);
  });
});

describe("fetchOrgName", () => {
  const okFetch = (status: number, body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as typeof fetch;

  it("asks the Clerk Backend API for the organization with the secret key as a bearer token", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fake: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ id: "org_abc", name: "Solenne" }), { status: 200 });
    };
    expect(await fetchOrgName("org_abc", "sk_test_secret", fake)).toBe("Solenne");
    expect(calls).toEqual([{ url: "https://api.clerk.com/v1/organizations/org_abc", auth: "Bearer sk_test_secret" }]);
  });

  it("explains a failure without leaking the secret key", async () => {
    const error = await fetchOrgName("org_missing", "sk_test_secret", okFetch(404, { errors: [{ message: "not found" }] })).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/404/);
    expect((error as Error).message).not.toContain("sk_test_secret");
  });

  it("refuses to look anything up without a secret key", async () => {
    await expect(fetchOrgName("org_abc", undefined, okFetch(200, {}))).rejects.toThrow(/CLERK_SECRET_KEY/);
  });
});

describe("runCli", () => {
  const run = async (argv: string[]) => {
    const out: string[] = [];
    const code = await runCli(argv, { db, lookupName: async () => "Solenne", log: (l) => out.push(l) });
    return { code, out: out.join("\n") };
  };

  it("creates a tenant and says so", async () => {
    const { code, out } = await run(["--org", "org_abc"]);
    expect(code).toBe(0);
    expect(out).toMatch(/created tenant Solenne/i);
    expect(out).toContain("org_abc");
  });

  it("reports an existing tenant and still exits 0", async () => {
    await run(["--org", "org_abc"]);
    const { code, out } = await run(["--org", "org_abc"]);
    expect(code).toBe(0);
    expect(out).toMatch(/already exists/i);
  });

  it("prints usage and exits 2 without --org", async () => {
    const { code, out } = await run([]);
    expect(code).toBe(2);
    expect(out).toMatch(/usage/i);
  });

  it("prints the problem and exits 1 when the org id is bad", async () => {
    const { code, out } = await run(["--org", "nope"]);
    expect(code).toBe(1);
    expect(out).toMatch(/org_/);
  });
});
