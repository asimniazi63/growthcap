import type { z } from "zod";
import type { Db } from "../db/client";
import type { ActionKind } from "../db/schema";
import type { TenantContext } from "../tenancy/context";

export { ACTION_KINDS, ACTION_STATUSES, type ActionKind, type ActionStatus } from "../db/schema";

// The contract between the action ledger (lib/actions/ledger.ts, T9) and the things that use it: the executors for the
// three Shopify writes (T8 part D, lib/actions/executors/) and the landing-page writer (T9, lib/landing/).

// What an approval card shows. Built on the server from the payload, never typed by the model.
export interface ActionDiff {
  summary: string; // one plain sentence: what will change
  rows?: { label: string; before?: string; after: string }[]; // a before and after, already formatted for people
  mutations?: { name: string; query: string; variables: unknown }[]; // the exact GraphQL that would run (shown for a dry run)
  files?: { path: string; content: string }[]; // for a landing page: the Liquid files that would be written
  notes?: string[]; // checks that ran, such as "Theme Check passed"
}

// What an executor needs to run. `graphql` is bound to the tenant's own connected store by the ledger: an executor never
// chooses a shop, and never receives a token.
export interface ExecEnv {
  db: Db;
  ctx: TenantContext;
  graphql: (query: string, variables?: unknown) => Promise<unknown>; // throws on a Shopify error or a userErrors list
}

export interface Executor<P = unknown> {
  kind: ActionKind;
  schema: z.ZodType<P>; // strict: the payload is validated again at approval time and again before it runs
  diff: (payload: P, ctx: TenantContext, db: Db) => Promise<ActionDiff>;
  // Pure and offline: the mutations this payload would send. A reviewer's (dry run) approval shows these and sends nothing.
  mutations: (payload: P) => { name: string; query: string; variables: unknown }[];
  run: (payload: P, env: ExecEnv) => Promise<unknown>; // the result is stored in actions.result
}

export interface ProposeInput {
  kind: ActionKind;
  title: string; // at most 120 characters
  payload: unknown;
  hypothesis: string; // why this should help
  metric: string; // the metric it should move
  checkOn: string; // YYYY-MM-DD, when to look at whether it worked
}

// What the chat sends to the browser (as a `data-action` part) and what /api/actions returns. No token, no shop secret.
export interface ActionView {
  id: string;
  kind: ActionKind;
  status: "proposed" | "approved" | "running" | "done" | "failed" | "rejected";
  title: string;
  diff: ActionDiff;
  hypothesis: string;
  metric: string;
  checkOn: string;
  owner: string;
  dryRun: boolean;
  result?: unknown;
  error?: string | null;
  createdAt: string;
}

// The ledger API (implemented in lib/actions/ledger.ts). Every function takes the signed-in TenantContext and never a tenant id.
//   registerExecutor(e: Executor): void                       // executors register themselves; the ledger looks them up by kind
//   proposeAction(db, ctx, input: ProposeInput): Promise<ActionView>   // validates the payload, builds the diff, stores the hash. GC roles only.
//   listActions(db, ctx, opts?: { status?: string }): Promise<ActionView[]>
//   approveAction(db, ctx, id, deps?): Promise<ActionView>    // GC roles only (client_viewer: NotAllowedError). Re-validates the payload and
//                                                              // its hash, then moves proposed -> approved -> running in one conditional
//                                                              // update (a second approval does nothing). A reviewer login (see
//                                                              // lib/actions/reviewer.ts) is recorded as a dry run and never calls Shopify.
//   rejectAction(db, ctx, id): Promise<ActionView>
// `deps` carries the injected graphql function and env for tests.
