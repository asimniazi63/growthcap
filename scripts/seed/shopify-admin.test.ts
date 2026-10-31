import { describe, expect, it } from "vitest";
import { assertNoUserErrors, createAdminClient, ShopifyAdminError, UserErrorsError } from "./shopify-admin.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface Harness {
  fetch: typeof fetch;
  tokenRequests: number;
  graphqlTokens: string[];
  sleeps: number[];
}

// graphqlResponses are consumed in order, one per GraphQL request.
function harness(graphqlResponses: (() => Response)[], expiresIn = 86_399): Harness {
  const h: Harness = { fetch: undefined as unknown as typeof fetch, tokenRequests: 0, graphqlTokens: [], sleeps: [] };
  let i = 0;
  h.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/admin/oauth/access_token")) {
      h.tokenRequests++;
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("grant_type")).toBe("client_credentials");
      return json({ access_token: `token-${h.tokenRequests}`, scope: "write_orders", expires_in: expiresIn });
    }
    expect(u).toBe("https://shop.myshopify.com/admin/api/2026-10/graphql.json");
    h.graphqlTokens.push(new Headers(init?.headers).get("X-Shopify-Access-Token") ?? "");
    const next = graphqlResponses[i++];
    if (!next) throw new Error("unexpected extra GraphQL request");
    return next();
  }) as typeof fetch;
  return h;
}

function client(h: Harness, clock = { t: 0 }) {
  return createAdminClient({
    shop: "shop.myshopify.com",
    clientId: "id",
    clientSecret: "secret",
    fetch: h.fetch,
    now: () => clock.t,
    sleep: async (ms) => {
      h.sleeps.push(ms);
      clock.t += ms;
    },
  });
}

const ok = (data: unknown) => () => json({ data });

describe("createAdminClient", () => {
  it("gets a token with the client credentials grant and reuses it", async () => {
    const h = harness([ok({ a: 1 }), ok({ a: 2 })]);
    const c = client(h);
    await c.graphql("query { a }");
    await c.graphql("query { a }");
    expect(h.tokenRequests).toBe(1);
    expect(h.graphqlTokens).toEqual(["token-1", "token-1"]);
  });

  it("renews the token once when Shopify answers 401, then retries the same request", async () => {
    const h = harness([() => json({}, 401), ok({ shop: "x" })]);
    const data = await client(h).graphql<{ shop: string }>("query { shop }");
    expect(data.shop).toBe("x");
    expect(h.tokenRequests).toBe(2);
    expect(h.graphqlTokens).toEqual(["token-1", "token-2"]);
  });

  it("gives up with a clear error when a fresh token is also rejected", async () => {
    const h = harness([() => json({}, 401), () => json({}, 401)]);
    await expect(client(h).graphql("query { shop }")).rejects.toMatchObject({ name: "ShopifyAdminError", kind: "auth" });
  });

  it("asks for a new token when the cached one has expired", async () => {
    const clock = { t: 0 };
    const h = harness([ok({}), ok({})], 3600);
    const c = client(h, clock);
    await c.graphql("query { a }");
    clock.t = 3_600_000; // past expiry (with the safety margin)
    await c.graphql("query { a }");
    expect(h.tokenRequests).toBe(2);
  });

  it("waits for the bucket to refill when Shopify says THROTTLED, then retries", async () => {
    const throttled = () =>
      json({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: { cost: { requestedQueryCost: 150, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 50, restoreRate: 100 } } },
      });
    const h = harness([throttled, ok({ done: true })]);
    await expect(client(h).graphql("query { a }")).resolves.toEqual({ done: true });
    expect(h.sleeps).toEqual([1000]); // (150 - 50) / 100 per second
  });

  it("backs off exponentially on 5xx and succeeds on the next try", async () => {
    const h = harness([() => json({}, 503), () => json({}, 502), ok({ done: true })]);
    await expect(client(h).graphql("query { a }")).resolves.toEqual({ done: true });
    expect(h.sleeps).toEqual([1000, 2000]);
  });

  it("throws after the retries are used up", async () => {
    const h = harness(Array.from({ length: 10 }, () => () => json({}, 503)));
    await expect(client(h).graphql("query { a }")).rejects.toMatchObject({ kind: "http", status: 503 });
  });

  it("reports a protected-customer-data refusal as access_denied", async () => {
    const denied = () =>
      json({ errors: [{ message: "This app is not approved to access the Customer object.", extensions: { code: "ACCESS_DENIED" } }] });
    const h = harness([denied]);
    const err = await client(h).graphql("query { customers(first:1){nodes{id}} }").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShopifyAdminError);
    expect((err as ShopifyAdminError).kind).toBe("access_denied");
  });
});

describe("assertNoUserErrors", () => {
  it("passes on an empty or missing list", () => {
    expect(() => assertNoUserErrors("orderCreate", [])).not.toThrow();
    expect(() => assertNoUserErrors("orderCreate", undefined)).not.toThrow();
  });
  it("throws with every message so the failure can be reported", () => {
    try {
      assertNoUserErrors("orderCreate", [{ field: ["order", "processedAt"], message: "is invalid" }, { message: "other" }]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(UserErrorsError);
      expect((e as UserErrorsError).messages).toEqual(["order.processedAt: is invalid", "other"]);
    }
  });
});
