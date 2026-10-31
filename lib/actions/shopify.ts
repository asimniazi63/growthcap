import { and, eq } from "drizzle-orm";
import { decryptSecret } from "../crypto/secrets";
import type { Db } from "../db/client";
import { shopConnections } from "../db/schema";
import { AppError } from "../errors";
import { shopifyGraphql, type GraphqlDeps } from "../shopify/client";
import type { TenantContext } from "../tenancy/context";
import type { ExecEnv } from "./types";

type Graphql = ExecEnv["graphql"];

function describeUserError(e: unknown): string {
  if (!e || typeof e !== "object") return String(e);
  const { message, field } = e as { message?: unknown; field?: unknown };
  const where = Array.isArray(field) && field.length > 0 ? `${field.join(".")}: ` : "";
  return `${where}${typeof message === "string" ? message : "rejected"}`;
}

// Every message in a `userErrors` list anywhere in a mutation's response (Shopify nests it under the mutation's name).
function userErrorsIn(value: unknown, depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 6) return [];
  if (Array.isArray(value)) return value.flatMap((v) => userErrorsIn(v, depth + 1));
  return Object.entries(value).flatMap(([key, v]) => (key === "userErrors" && Array.isArray(v) ? v.map(describeUserError) : userErrorsIn(v, depth + 1)));
}

// A write that Shopify answers with an `errors` array or any `userErrors` did not happen, whatever the HTTP status was.
export function checkedGraphql(raw: Graphql): Graphql {
  return async (query, variables) => {
    const result = await raw(query, variables);
    const errors = (result as { errors?: unknown } | null)?.errors;
    if (Array.isArray(errors) ? errors.length > 0 : Boolean(errors)) {
      const messages = Array.isArray(errors) ? errors.map(describeUserError) : [String(errors)];
      throw new AppError("INVALID_INPUT", `Shopify refused the change: ${messages.join("; ").slice(0, 400)}`);
    }
    const userErrors = userErrorsIn(result);
    if (userErrors.length > 0) throw new AppError("INVALID_INPUT", `Shopify refused the change: ${userErrors.join("; ").slice(0, 400)}`);
    return result;
  };
}

// An Admin GraphQL function bound to this tenant's connected store. The token is decrypted here, used for the request
// header inside shopifyGraphql, and never handed to an executor; an error that somehow mentions it is scrubbed.
export async function shopGraphqlFor(db: Db, ctx: TenantContext, deps: GraphqlDeps = {}): Promise<Graphql> {
  const [conn] = await db
    .select()
    .from(shopConnections)
    .where(and(eq(shopConnections.tenantId, ctx.tenantId), eq(shopConnections.status, "connected")))
    .limit(1);
  if (!conn?.tokenEnc) throw new AppError("STORE_DISCONNECTED", "The store is disconnected. Reconnect it, then ask for the change again.");
  const token = decryptSecret(conn.tokenEnc);
  return checkedGraphql(async (query, variables) => {
    try {
      return await shopifyGraphql<unknown>({ shopDomain: conn.shopDomain, accessToken: token }, query, variables as Record<string, unknown> | undefined, deps);
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).split(token).join("[redacted]");
      throw e instanceof AppError ? new AppError(e.code, message, { retryable: e.retryable }) : new Error(message);
    }
  });
}
