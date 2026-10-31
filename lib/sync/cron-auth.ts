import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

// Cron jobs have no user: they prove themselves with CRON_SECRET, sent as a bearer token. With no secret
// configured nothing is authorized, so a missing variable can't leave the job open.
export function cronAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return timingSafeEqual(digest(header.slice("Bearer ".length)), digest(secret));
}
