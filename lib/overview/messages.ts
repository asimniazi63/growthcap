// The words shown after a person approves or rejects a proposed change. The Overview page and the action card say the same
// thing, so the wording lives here.

export type Decision = "approve" | "reject";
export type ToastTone = "ok" | "error";

export interface DecidedAction {
  status: string;
  dryRun?: boolean;
  error?: string | null;
}

export function decisionToast(decision: Decision, action: DecidedAction): { message: string; tone: ToastTone } {
  if (decision === "reject") return { message: "Rejected. Nothing was changed.", tone: "ok" };
  if (action.status === "failed") return { message: `Approved, but it failed: ${action.error ?? "The change did not go through."}`, tone: "error" };
  if (action.dryRun) return { message: "Approved. Dry run: nothing was sent to Shopify.", tone: "ok" };
  return { message: "Approved. Running now.", tone: "ok" };
}

// What to tell the person when the decision did not save. `body` is the parsed JSON of the response, if there was one.
export function decisionFailure(status: number | undefined, body: unknown): string {
  if (status === 404) return "This action no longer exists.";
  if (status === 403) return "Only a Growth Capital admin or partner can decide this.";
  const message = (body as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : "Couldn't save that. Try again.";
}
