import { AppError } from "../../errors";

// Shopify answers a refused write with HTTP 200 and a `userErrors` list. The ledger's graphql function is meant to throw on
// one, but an executor must not count a write as done on that promise alone, so each run checks the list itself.
export function writeResult(data: unknown, mutation: string): Record<string, unknown> {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>)[mutation] : undefined;
  if (!root || typeof root !== "object") throw new AppError("INTERNAL_ERROR", `Shopify returned no result for ${mutation}`);
  const errors = (root as { userErrors?: unknown }).userErrors;
  if (Array.isArray(errors) && errors.length > 0) {
    const text = errors.map((e) => (e && typeof e === "object" && "message" in e ? String(e.message) : String(e))).join("; ");
    throw new AppError("INVALID_INPUT", `Shopify refused ${mutation}: ${text}`);
  }
  return root as Record<string, unknown>;
}
