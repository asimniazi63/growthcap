import { AppError } from "../errors";
import { SHOPIFY_API_VERSION } from "./version";

export interface ShopConnection {
  shopDomain: string; // <handle>.myshopify.com
  accessToken: string;
}

export interface GraphqlDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  // How many calls to make in total before giving up (default 3), including the first one.
  maxRetries?: number;
}

interface ThrottleCost {
  requestedQueryCost?: number;
  throttleStatus?: { currentlyAvailable?: number; restoreRate?: number };
}

interface GraphqlBody {
  data?: unknown;
  errors?: unknown;
  extensions?: { cost?: ThrottleCost };
}

const DEFAULT_ATTEMPTS = 3;
const MIN_WAIT_MS = 250;
const MAX_WAIT_MS = 30_000;

const backoff = (attempt: number) => Math.min(MAX_WAIT_MS, 1000 * 2 ** attempt);

// How long until the bucket has room for the query: (cost still missing) / (points restored per second).
function throttleWait(cost: ThrottleCost | undefined, attempt: number): number {
  const need = (cost?.requestedQueryCost ?? 0) - (cost?.throttleStatus?.currentlyAvailable ?? 0);
  const rate = cost?.throttleStatus?.restoreRate ?? 0;
  const ms = rate > 0 && need > 0 ? Math.ceil((need / rate) * 1000) : backoff(attempt);
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, ms));
}

function errorMessages(errors: unknown): string[] {
  if (Array.isArray(errors)) {
    return errors.map((e) => (e && typeof e === "object" && "message" in e ? String(e.message) : String(e)));
  }
  return [String(errors)];
}

const isThrottled = (errors: unknown): boolean =>
  Array.isArray(errors) &&
  errors.some((e) => e && typeof e === "object" && "extensions" in e && (e.extensions as { code?: unknown } | null)?.code === "THROTTLED");

// Admin GraphQL from the server only. A throttle arrives as a THROTTLED error in a 200 response, not a 429.
// The token goes in the header and nowhere else: it is never logged and never put in an error.
export async function shopifyGraphql<T>(
  conn: ShopConnection,
  query: string,
  variables?: Record<string, unknown>,
  deps: GraphqlDeps = {},
): Promise<T> {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = deps.maxRetries ?? DEFAULT_ATTEMPTS;
  const url = `https://${conn.shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const unavailable = (why: string) =>
    new AppError("SHOPIFY_UNAVAILABLE", `Shopify is unavailable (${why}) for ${conn.shopDomain}`, { retryable: true });

  for (let attempt = 0; ; attempt++) {
    const last = attempt >= attempts - 1;
    let failure: AppError;
    let wait = backoff(attempt);

    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": conn.accessToken },
        body: JSON.stringify({ query, variables }),
      });

      if (res.status === 401) {
        throw new AppError("STORE_DISCONNECTED", `Shopify rejected the access token for ${conn.shopDomain}`);
      }
      if (res.status === 429 || res.status >= 500) {
        failure = unavailable(`HTTP ${res.status}`);
      } else if (!res.ok) {
        throw new AppError("INVALID_INPUT", `Shopify answered HTTP ${res.status}`);
      } else {
        const body = (await res.json().catch(() => null)) as GraphqlBody | null;
        if (!body) {
          failure = unavailable("the response was not JSON");
        } else if (isThrottled(body.errors)) {
          failure = new AppError("SHOPIFY_THROTTLED", `Shopify kept throttling requests for ${conn.shopDomain}`, { retryable: true });
          wait = throttleWait(body.extensions?.cost, attempt);
        } else if (body.errors) {
          throw new AppError("INVALID_INPUT", errorMessages(body.errors).join("; "));
        } else {
          return body.data as T;
        }
      }
    } catch (e) {
      if (e instanceof AppError) throw e;
      failure = unavailable("a network error");
    }

    if (last) throw failure;
    await sleep(wait);
  }
}
