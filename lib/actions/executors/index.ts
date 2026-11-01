import { landingPageExecutor } from "../../landing/executor";
import { registerExecutor } from "../registry";
import type { Executor } from "../types";
import { annotationExecutor } from "./annotation";
import { discountDeactivateExecutor } from "./discount-deactivate";
import { metricTargetExecutor } from "./metric-target";
import { segmentCreateExecutor } from "./segment-create";
import { unitCostExecutor } from "./unit-cost";

// Importing this file registers every executor by kind. The ledger looks them up by kind, so whatever loads the ledger for a
// real request imports this once (tests that need one executor import it directly instead).
// Each executor is typed by its own payload; the registry holds them as Executor<unknown> and validates payloads itself.
for (const e of [metricTargetExecutor, annotationExecutor, discountDeactivateExecutor, landingPageExecutor, unitCostExecutor, segmentCreateExecutor]) {
  registerExecutor(e as unknown as Executor);
}

export { annotationExecutor, discountDeactivateExecutor, landingPageExecutor, metricTargetExecutor, segmentCreateExecutor, unitCostExecutor };
