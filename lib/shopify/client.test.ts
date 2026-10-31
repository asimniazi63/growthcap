import { describe, expect, it, vi } from "vitest";
import { AppError } from "../errors";
import { shopifyGraphql, type ShopConnection } from "./client";

const TOKEN = "shpat_super_secret_token_value";
const conn: ShopConnection = { shopDomain: "solenne-test.myshopify.com", accessToken: TOKEN };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const throttled = (cost?: { requested: number; available: number; rate: number }) =>
  json({
    errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
    ...(cost
      ? {
          extensions: {
            cost: {
              requestedQueryCost: cost.requested,
              throttleStatus: { maximumAvailable: 1000, currentlyAvailable: cost.available, restoreRate: cost.rate },
            },
          },
        }
      : {}),
  });

function setup(respond: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => respond());
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {});
  const run = <T = unknown>(query = "{ shop { name } }", variables?: Record<string, unknown>) =>
    shopifyGraphql<T>(conn, query, variables, { fetch: fetchMock, sleep });
  return { fetchMock, sleep, run };
}

function sequence(...responses: (Response | Error)[]) {
  let i = 0;
  return () => {
    const next = responses[Math.min(i++, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return next.clone();
  };
}

async function catchError(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected the call to throw");
}

describe("shopifyGraphql", () => {
  it("posts the query to the pinned API version with the token in the header", async () => {
    const { fetchMock, run } = setup(() => json({ data: { shop: { name: "Solenne" } } }));
    const result = await run<{ shop: { name: string } }>("query Q { shop { name } }", { first: 5 });
    expect(result).toEqual({ shop: { name: "Solenne" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://solenne-test.myshopify.com/admin/api/2026-10/graphql.json");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe(TOKEN);
    expect(JSON.parse(String(init?.body))).toEqual({ query: "query Q { shop { name } }", variables: { first: 5 } });
  });

  it("retries a THROTTLED answer in a 200 response, waiting as long as the cost needs", async () => {
    const { fetchMock, sleep, run } = setup(
      sequence(throttled({ requested: 100, available: 40, rate: 50 }), json({ data: { ok: true } })),
    );
    await expect(run()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1200); // (100 - 40) / 50 seconds
  });

  it("waits at least 250 ms and at most 30 s on a throttle", async () => {
    const short = setup(sequence(throttled({ requested: 51, available: 50, rate: 100 }), json({ data: 1 })));
    await short.run();
    expect(short.sleep).toHaveBeenCalledWith(250);

    const long = setup(sequence(throttled({ requested: 10_000, available: 0, rate: 1 }), json({ data: 1 })));
    await long.run();
    expect(long.sleep).toHaveBeenCalledWith(30_000);
  });

  it("falls back to a backoff when the throttle carries no cost information", async () => {
    const { sleep, run } = setup(sequence(throttled(), json({ data: 1 })));
    await run();
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("throws SHOPIFY_THROTTLED when the throttle never clears", async () => {
    const { fetchMock, run } = setup(() => throttled({ requested: 100, available: 0, rate: 50 }));
    const err = await catchError(run());
    expect(err.code).toBe("SHOPIFY_THROTTLED");
    expect(err.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws STORE_DISCONNECTED on a 401 and does not retry", async () => {
    const { fetchMock, run } = setup(() => json({ errors: "[API] Invalid API key or access token" }, 401));
    const err = await catchError(run());
    expect(err.code).toBe("STORE_DISCONNECTED");
    expect(err.retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws SHOPIFY_UNAVAILABLE after three 503s", async () => {
    const { fetchMock, sleep, run } = setup(() => json({ errors: "Service Unavailable" }, 503));
    const err = await catchError(run());
    expect(err.code).toBe("SHOPIFY_UNAVAILABLE");
    expect(err.retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // between attempts, not after the last
  });

  it("recovers from a 503 followed by success", async () => {
    const { fetchMock, run } = setup(sequence(json({}, 503), json({ data: { ok: 1 } })));
    await expect(run()).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 and a network error, then gives up with SHOPIFY_UNAVAILABLE", async () => {
    const tooMany = setup(() => json({}, 429));
    expect((await catchError(tooMany.run())).code).toBe("SHOPIFY_UNAVAILABLE");
    expect(tooMany.fetchMock).toHaveBeenCalledTimes(3);

    const down = setup(sequence(new TypeError("fetch failed")));
    expect((await catchError(down.run())).code).toBe("SHOPIFY_UNAVAILABLE");
    expect(down.fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats a 200 whose body is not JSON as unavailable", async () => {
    const { run } = setup(() => new Response("<html>gateway</html>", { status: 200 }));
    expect((await catchError(run())).code).toBe("SHOPIFY_UNAVAILABLE");
  });

  it("throws INVALID_INPUT with the messages for a GraphQL error that is not a throttle, without retrying", async () => {
    const { fetchMock, run } = setup(() =>
      json({ errors: [{ message: "Field 'nope' doesn't exist on type 'Shop'" }, { message: "Second problem" }] }),
    );
    const err = await catchError(run());
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("Field 'nope' doesn't exist on type 'Shop'");
    expect(err.message).toContain("Second problem");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps any other HTTP error to INVALID_INPUT without retrying", async () => {
    const { fetchMock, run } = setup(() => json({}, 404));
    const err = await catchError(run());
    expect(err.code).toBe("INVALID_INPUT");
    expect(err.message).toContain("404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("honours maxRetries as the number of attempts", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({}, 503));
    const err = await catchError(
      shopifyGraphql(conn, "{ shop { name } }", undefined, { fetch: fetchMock, sleep: async () => {}, maxRetries: 5 }),
    );
    expect(err.code).toBe("SHOPIFY_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("never puts the access token in an error", async () => {
    const scenarios: Array<() => Response> = [
      () => json({ errors: "Invalid token" }, 401),
      () => json({}, 503),
      () => json({ errors: [{ message: "bad field" }] }),
      () => throttled({ requested: 100, available: 0, rate: 50 }),
      () => json({}, 404),
    ];
    for (const respond of scenarios) {
      const err = await catchError(setup(respond).run());
      expect(err.message).not.toContain(TOKEN);
      expect(JSON.stringify(err)).not.toContain(TOKEN);
      expect(String(err.stack)).not.toContain(TOKEN);
    }
  });
});
