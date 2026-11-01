import { json, withTenant } from "@/lib/api/respond";
import { getDb } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { loadSegmentCustomers } from "@/lib/metrics/segments";
import { canViewSegments } from "@/lib/segments/access";
import { exportFilename, segmentCsv } from "@/lib/segments/csv";
import { SEGMENT_IDS, type SegmentId } from "@/lib/segments/definitions";

export const runtime = "nodejs";
export const maxDuration = 30;

// `segment` is optional (none means the four segments together). It is checked against the fixed list, and an unknown, empty or
// repeated value is refused, so nothing the caller types reaches the file or its name.
function parseSegment(params: URLSearchParams): SegmentId | undefined {
  const given = params.getAll("segment");
  if (given.length === 0) return undefined;
  const found = given.length === 1 ? SEGMENT_IDS.find((id) => id === given[0]) : undefined;
  if (!found) throw new AppError("INVALID_INPUT", `segment must be one of ${SEGMENT_IDS.join(", ")}, or left out for all of them.`);
  return found;
}

// A Growth Capital admin or partner downloads the signed-in brand's customers as a CSV for a Klaviyo import. The brand and the role
// come from the Clerk session, never from the query. Customers are pseudonymous ids, so there is no email column.
export const GET = (req: Request) =>
  withTenant(async (ctx) => {
    if (!canViewSegments(ctx)) return json({ error: "FORBIDDEN" }, 403);
    const segment = parseSegment(new URL(req.url).searchParams);
    if (!ctx.shop || ctx.shop.status !== "connected") throw new AppError("STORE_DISCONNECTED", "The store is not connected, so the segments can't be exported. Reconnect it and try again.");
    const { asOf, customers } = await loadSegmentCustomers(getDb(), ctx.tenantId);
    return new Response(segmentCsv(customers, segment), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename(asOf, segment)}"`,
        "Cache-Control": "no-store",
      },
    });
  });
