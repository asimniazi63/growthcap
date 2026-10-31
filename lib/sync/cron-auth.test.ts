import { describe, expect, it } from "vitest";
import { cronAuthorized } from "./cron-auth";

const SECRET = "a-long-random-cron-secret";
const req = (authorization?: string) => new Request("https://x.test/api/cron/refresh", { headers: authorization ? { authorization } : {} });

describe("cronAuthorized", () => {
  it("accepts the bearer secret Vercel Cron sends", () => {
    expect(cronAuthorized(req(`Bearer ${SECRET}`), SECRET)).toBe(true);
  });
  it("rejects a missing, wrong, or differently-shaped header", () => {
    expect(cronAuthorized(req(), SECRET)).toBe(false);
    expect(cronAuthorized(req("Bearer nope"), SECRET)).toBe(false);
    expect(cronAuthorized(req(SECRET), SECRET)).toBe(false);
    expect(cronAuthorized(req(`Basic ${SECRET}`), SECRET)).toBe(false);
    expect(cronAuthorized(req(`Bearer  ${SECRET}`), SECRET)).toBe(false); // the Headers API trims the ends, so test an inner space
  });
  it("never authorizes when no secret is configured, even for an empty bearer", () => {
    expect(cronAuthorized(req("Bearer "), undefined)).toBe(false);
    expect(cronAuthorized(req("Bearer "), "")).toBe(false);
    expect(cronAuthorized(req(), "")).toBe(false);
  });
});
