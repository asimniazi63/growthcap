import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const req = (authorization?: string) => new Request("https://x.test/api/cron/brief", { headers: authorization ? { authorization } : {} });

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/brief", () => {
  it("refuses a missing or wrong secret before touching anything", async () => {
    vi.stubEnv("CRON_SECRET", "a-long-random-cron-secret");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect((await GET(req("a-long-random-cron-secret"))).status).toBe(401);
  });

  it("is closed when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(500);
  });
});
