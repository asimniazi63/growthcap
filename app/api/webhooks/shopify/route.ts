import { getDb } from "@/lib/db/client";
import { handleWebhook } from "@/lib/shopify/webhooks";

export const runtime = "nodejs";

// Public route (proxy.ts leaves it alone): authenticity comes from the HMAC, checked against the raw body.
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return new Response("Webhook secret is not configured", { status: 500 });
  const rawBody = await request.text();
  const { status } = await handleWebhook({ db: getDb(), rawBody, headers: request.headers, secret });
  return new Response(null, { status });
}
