import type { Db } from "../db/client";
import type { DriverTreeResult } from "./types";

// STUB. The Why work (T7) replaces this file; the signature stays. Deterministic: the same data gives the same tree.
export async function driverTree(_db: Db, _tenantId: string, period: { month: string }): Promise<DriverTreeResult> {
  return { month: period.month, targetCents: 0, actualCents: 0, gapCents: 0, drivers: [] };
}
