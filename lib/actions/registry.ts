import { AppError } from "../errors";
import type { ActionKind, Executor } from "./types";

// Executors register themselves by kind (lib/actions/executors/index.ts imports them all). The ledger looks one up here, so
// it never imports an executor directly, and a test can register a fake in its place.
const executors = new Map<ActionKind, Executor>();
let loading: Promise<unknown> | undefined;

export function registerExecutor<P>(e: Executor<P>): void {
  executors.set(e.kind, e as unknown as Executor);
}

export async function getExecutor(kind: ActionKind): Promise<Executor> {
  const found = executors.get(kind);
  if (found) return found;
  // Loaded on first need and once only; a test that registers its own fakes never pays for the real ones.
  loading ??= import("./executors").catch((e) => {
    console.error("[actions] could not load the executors:", e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200));
  });
  await loading;
  const loaded = executors.get(kind);
  if (!loaded) throw new AppError("INVALID_INPUT", `There is no action of kind "${String(kind).slice(0, 40)}".`);
  return loaded;
}
