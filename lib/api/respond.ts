import { AppError } from "../errors";
import { NotAllowedError } from "../memory/store";
import { getTenantContext, type TenantContext } from "../tenancy/context";

// Shared by the small JSON routes (threads, pinned views, notes). The brand and the person come from the Clerk session
// and nowhere else; nothing in a request names them.

export const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export function errorResponse(e: unknown): Response {
  if (e instanceof NotAllowedError) return json({ error: "FORBIDDEN" }, 403);
  if (e instanceof AppError) return json({ error: e.code, message: e.message }, e.code === "INVALID_INPUT" ? 400 : e.code === "NO_DATA" ? 404 : 502);
  console.error("[api] unexpected error:", e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : String(e).slice(0, 200));
  return json({ error: "INTERNAL_ERROR" }, 500);
}

export async function withTenant(handler: (ctx: TenantContext) => Promise<Response>, getCtx: () => Promise<TenantContext> = getTenantContext): Promise<Response> {
  let ctx: TenantContext;
  try {
    ctx = await getCtx();
  } catch {
    return json({ error: "FORBIDDEN" }, 403);
  }
  try {
    return await handler(ctx);
  } catch (e) {
    return errorResponse(e);
  }
}

export async function readJson(request: Request, maxBytes = 50_000): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new AppError("INVALID_INPUT", "That request is too large.");
  return request.json().catch(() => {
    throw new AppError("INVALID_INPUT", "The request body must be JSON.");
  });
}
