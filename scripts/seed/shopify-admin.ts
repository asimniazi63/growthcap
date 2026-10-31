import { API_VERSION } from "./stores.js";

export interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

export type AdminErrorKind = "access_denied" | "auth" | "http" | "graphql" | "throttled";

export class ShopifyAdminError extends Error {
  constructor(
    message: string,
    readonly kind: AdminErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ShopifyAdminError";
  }
}

// A 200 response whose payload carries userErrors is a failure. It is never journaled as done.
export class UserErrorsError extends Error {
  readonly messages: string[];
  constructor(
    readonly label: string,
    errors: UserError[],
  ) {
    const messages = errors.map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message));
    super(`${label}: ${messages.join("; ")}`);
    this.name = "UserErrorsError";
    this.messages = messages;
  }
}

export function assertNoUserErrors(label: string, userErrors: UserError[] | null | undefined): void {
  if (userErrors && userErrors.length > 0) throw new UserErrorsError(label, userErrors);
}

export interface GraphqlClient {
  graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T>;
}

export interface AdminClientOptions {
  shop: string; // <handle>.myshopify.com
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  apiVersion?: string;
  maxRetries?: number;
  baseDelayMs?: number;
}

interface GraphqlResponse {
  data?: unknown;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
}

const TOKEN_MARGIN_MS = 60_000;
const MAX_DELAY_MS = 30_000;

// The seeder app's client: client credentials grant (tokens last 24 h; cached and renewed on expiry or a 401),
// throttle-aware retries, exponential backoff on 429/5xx/network errors. It never logs the token or secret.
export function createAdminClient(opts: AdminClientOptions): GraphqlClient & { shop: string } {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRetries = opts.maxRetries ?? 6;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const endpoint = `https://${opts.shop}/admin/api/${opts.apiVersion ?? API_VERSION}/graphql.json`;
  let cached: { token: string; expiresAt: number } | null = null;

  async function token(): Promise<string> {
    if (cached && now() < cached.expiresAt) return cached.token;
    const res = await fetchFn(`https://${opts.shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: opts.clientId, client_secret: opts.clientSecret }),
    });
    if (!res.ok) {
      throw new ShopifyAdminError(
        `Shopify refused the seeder's client credentials (HTTP ${res.status}). Is the seeder app installed on ${opts.shop}?`,
        "auth",
        res.status,
      );
    }
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    cached = { token: body.access_token, expiresAt: now() + (body.expires_in ?? 86_400) * 1000 - TOKEN_MARGIN_MS };
    return cached.token;
  }

  const backoff = (attempt: number) => Math.min(MAX_DELAY_MS, baseDelay * 2 ** attempt);

  async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let attempt = 0;
    let renewed = false;
    for (;;) {
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await token() },
        body: JSON.stringify({ query, variables }),
      }).catch((e: unknown) => e as Error);

      if (res instanceof Error) {
        if (attempt >= maxRetries) throw new ShopifyAdminError(`Network error talking to Shopify: ${res.message}`, "http");
        await sleep(backoff(attempt++));
        continue;
      }
      if (res.status === 401) {
        if (renewed) {
          throw new ShopifyAdminError(`Shopify rejected a fresh seeder token (401). Is the seeder app still installed on ${opts.shop}?`, "auth", 401);
        }
        renewed = true;
        cached = null;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= maxRetries) throw new ShopifyAdminError(`Shopify kept answering HTTP ${res.status}`, "http", res.status);
        await sleep(backoff(attempt++));
        continue;
      }
      if (!res.ok) throw new ShopifyAdminError(`Shopify answered HTTP ${res.status}`, "http", res.status);

      const body = (await res.json()) as GraphqlResponse;
      if (body.errors?.length) {
        if (body.errors.some((e) => e.extensions?.code === "THROTTLED")) {
          if (attempt >= maxRetries) throw new ShopifyAdminError("Shopify kept throttling the request", "throttled");
          const cost = body.extensions?.cost;
          const need = (cost?.requestedQueryCost ?? 0) - (cost?.throttleStatus?.currentlyAvailable ?? 0);
          const rate = cost?.throttleStatus?.restoreRate ?? 0;
          const wait = rate > 0 && need > 0 ? Math.ceil((need / rate) * 1000) : backoff(attempt);
          attempt++;
          await sleep(Math.min(MAX_DELAY_MS, Math.max(wait, 250)));
          continue;
        }
        const message = body.errors.map((e) => e.message).join("; ");
        const denied = body.errors.some((e) => e.extensions?.code === "ACCESS_DENIED" || /not approved to access/i.test(e.message));
        throw new ShopifyAdminError(message, denied ? "access_denied" : "graphql");
      }
      return body.data as T;
    }
  }

  return { shop: opts.shop, graphql };
}

// A plain-words explanation for the terminal. Never includes tokens or secrets.
export function explainAdminError(e: unknown): string {
  if (e instanceof ShopifyAdminError && e.kind === "access_denied") {
    return [
      `Shopify refused the read: ${e.message}`,
      "This is the protected-customer-data risk T0 deferred. The product app is at Level 1 with no personal fields, and the seeder was left unset.",
      "Options: choose custom distribution for the app in the Dev Dashboard (the seeder first), or request the protected field the call needs, then re-run.",
    ].join("\n");
  }
  if (e instanceof ShopifyAdminError) return `Shopify error (${e.kind}${e.status ? ` ${e.status}` : ""}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
