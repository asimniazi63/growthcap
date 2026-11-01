import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/tenancy/context";
import { POST } from "./route";

// The session, the database handle and the playbook core are all mocked: this file checks only what the route decides on its own
// (who may run, what a body may say, the cooldown) and that the brand and person it passes on come from the session.
const m = vi.hoisted(() => ({
  ctx: vi.fn<() => Promise<TenantContext>>(),
  runPlaybook: vi.fn(),
  ranRecently: vi.fn(),
}));

vi.mock("@/lib/tenancy/context", () => ({ getTenantContext: m.ctx }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({ fake: "db" }) }));
vi.mock("@/lib/playbooks/generate", () => ({ runPlaybook: m.runPlaybook }));
vi.mock("@/lib/playbooks/store", () => ({
  canRunPlaybooks: (ctx: Pick<TenantContext, "role">) => ctx.role === "gc_admin" || ctx.role === "gc_partner",
  ranRecently: m.ranRecently,
}));

const shop = { domain: "solenne.myshopify.com", timezone: "America/New_York", currency: "USD", status: "connected" as const };
const session = (over: Partial<TenantContext> = {}): TenantContext => ({ tenantId: "tenant-a", orgId: "org_a", userId: "user_a", role: "gc_partner", shop, ...over });
const post = (body: unknown) => POST(new Request("https://x.test/api/playbooks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  m.ctx.mockResolvedValue(session());
  m.ranRecently.mockResolvedValue(false);
  m.runPlaybook.mockResolvedValue({ outcome: "ready", runId: "run-1" });
});

describe("POST /api/playbooks", () => {
  it("refuses a client viewer, and a request with no session, before running anything", async () => {
    m.ctx.mockResolvedValue(session({ role: "client_viewer" }));
    expect((await post({ playbook: "retention-check" })).status).toBe(403);
    m.ctx.mockRejectedValue(new Error("no session"));
    expect((await post({ playbook: "retention-check" })).status).toBe(403);
    expect(m.runPlaybook).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown playbook", { playbook: "drop-tables" }],
    ["no playbook", {}],
    ["an extra key", { playbook: "retention-check", tenantId: "tenant-b" }],
    ["a malformed month", { playbook: "monthly-review", month: "October" }],
    ["month 13", { playbook: "monthly-review", month: "2026-13" }],
    ["a month on a playbook that takes none", { playbook: "bfcm-review", month: "2026-10" }],
    ["a non-string month", { playbook: "monthly-review", month: 202610 }],
  ])("rejects %s with 400 and runs nothing", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("INVALID_INPUT");
    expect(m.runPlaybook).not.toHaveBeenCalled();
  });

  it("rejects a body that isn't JSON", async () => {
    const res = await POST(new Request("https://x.test/api/playbooks", { method: "POST", body: "playbook=bfcm-review" }));
    expect(res.status).toBe(400);
    expect(m.runPlaybook).not.toHaveBeenCalled();
  });

  it("runs the playbook for the session's brand and person, and returns the outcome", async () => {
    m.runPlaybook.mockResolvedValue({ outcome: "blocked", runId: "run-9" });
    const res = await post({ playbook: "monthly-review", month: "2026-09" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "blocked", id: "run-9" });
    expect(m.runPlaybook).toHaveBeenCalledTimes(1);
    expect(m.runPlaybook).toHaveBeenCalledWith({ fake: "db" }, { id: "tenant-a", orgId: "org_a", shop }, { userId: "user_a", role: "gc_partner" }, "monthly-review", { month: "2026-09" });
  });

  it("passes no month when none is given", async () => {
    expect((await post({ playbook: "monthly-review" })).status).toBe(200);
    expect(m.runPlaybook.mock.calls[0]?.[4]).toEqual({});
  });

  it("refuses a disconnected store", async () => {
    m.ctx.mockResolvedValue(session({ shop: { ...shop, status: "disconnected" } }));
    const res = await post({ playbook: "retention-check" });
    expect((await res.json()).error).toBe("STORE_DISCONNECTED");
    expect(m.runPlaybook).not.toHaveBeenCalled();
  });

  it("returns 429 when the same playbook ran for this brand in the last 10 minutes", async () => {
    m.ranRecently.mockResolvedValue(true);
    const res = await post({ playbook: "bfcm-review" });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("TOO_MANY_REQUESTS");
    expect(m.ranRecently).toHaveBeenCalledWith({ fake: "db" }, "tenant-a", "bfcm-review");
    expect(m.runPlaybook).not.toHaveBeenCalled();
  });

  it("returns 429 to a second click while the first run of that playbook is still going, but lets another playbook run", async () => {
    let finish: (v: unknown) => void = () => {};
    m.runPlaybook.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const first = post({ playbook: "retention-check" });
    await vi.waitFor(() => expect(m.runPlaybook).toHaveBeenCalledTimes(1));
    expect((await post({ playbook: "retention-check" })).status).toBe(429);
    expect((await post({ playbook: "bfcm-review" })).status).toBe(200);
    finish({ outcome: "ready", runId: "run-1" });
    expect((await first).status).toBe(200);
    expect((await post({ playbook: "retention-check" })).status).toBe(200);
  });
});
