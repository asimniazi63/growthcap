import { sql } from "drizzle-orm";
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { EncryptedSecret } from "../crypto/secrets";
import type { ViewSourceRef } from "../views/types";

// One row per client brand, made only by `npm run tenant:create -- --org <orgId>`. orgId is the Clerk organization id.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: text("org_id").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const SHOP_STATUSES = ["connected", "disconnected"] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

// The token is AES-256-GCM encrypted (lib/crypto/secrets.ts) and cleared when the app is uninstalled.
export const shopConnections = pgTable(
  "shop_connections",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    shopDomain: text("shop_domain").notNull(),
    tokenEnc: jsonb("token_enc").$type<EncryptedSecret>(),
    refreshTokenEnc: jsonb("refresh_token_enc").$type<EncryptedSecret>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scopes: text("scopes").notNull().default(""),
    status: text("status").$type<ShopStatus>().notNull().default("connected"),
    timezone: text("timezone").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shop_connections_shop_domain_key").on(t.shopDomain),
    uniqueIndex("shop_connections_one_connected_per_tenant").on(t.tenantId).where(sql`${t.status} = 'connected'`),
  ],
);

// Webhook deliveries, for idempotency: processedAt is set only after the handler succeeds, so a failed one is retried.
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    webhookId: text("webhook_id").notNull().unique(),
    topic: text("topic").notNull(),
    shopDomain: text("shop_domain").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("webhook_events_shop_domain_idx").on(t.shopDomain)],
);

// customers/data_request, customers/redact and shop/redact. We hold no personal data, so these are only recorded.
export const complianceRequests = pgTable("compliance_requests", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  shopDomain: text("shop_domain").notNull(),
  topic: text("topic").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---- Synced store data (T3). Every table has tenant_id first in its key. Ids are Shopify gids, except customers,
// which are a pseudonym (lib/sync/map.ts): no name, email, phone or address is ever stored. Money is integer cents.
const tenantRef = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);

export const products = pgTable(
  "products",
  {
    tenantId: tenantRef(),
    id: text("id").notNull(),
    title: text("title").notNull(),
    handle: text("handle").notNull(),
    status: text("status").notNull(),
    description: text("description").notNull().default(""), // store text: untrusted
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const variants = pgTable(
  "variants",
  {
    tenantId: tenantRef(),
    id: text("id").notNull(),
    productId: text("product_id").notNull(),
    sku: text("sku").notNull().default(""),
    title: text("title").notNull(),
    priceCents: integer("price_cents").notNull(),
    unitCostCents: integer("unit_cost_cents"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index("variants_product_idx").on(t.tenantId, t.productId)],
);

export const inventoryLevels = pgTable(
  "inventory_levels",
  {
    tenantId: tenantRef(),
    variantId: text("variant_id").notNull(),
    locationId: text("location_id").notNull(),
    locationName: text("location_name").notNull().default(""), // always empty: a location's name needs read_locations, which the app doesn't request
    available: integer("available").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.variantId, t.locationId] })],
);

export const customers = pgTable(
  "customers",
  {
    tenantId: tenantRef(),
    id: text("id").notNull(), // CUST_ + hash of tenant and Shopify id
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const orders = pgTable(
  "orders",
  {
    tenantId: tenantRef(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(), // the store-local date of processedAt
    customerId: text("customer_id"),
    grossCents: integer("gross_cents").notNull(), // sum of qty x unit price
    discountCents: integer("discount_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    discountCode: text("discount_code"),
    channel: text("channel").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    note: text("note"), // store text: untrusted
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index("orders_local_date_idx").on(t.tenantId, t.localDate),
    index("orders_customer_idx").on(t.tenantId, t.customerId),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    tenantId: tenantRef(),
    id: text("id").notNull(),
    orderId: text("order_id").notNull(),
    variantId: text("variant_id"),
    productId: text("product_id"),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(), // the price charged, before discounts
    discountCents: integer("discount_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index("order_lines_order_idx").on(t.tenantId, t.orderId)],
);

export const refunds = pgTable(
  "refunds",
  {
    tenantId: tenantRef(),
    id: text("id").notNull(),
    orderId: text("order_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index("refunds_local_date_idx").on(t.tenantId, t.localDate)],
);

export const refundLines = pgTable(
  "refund_lines",
  {
    tenantId: tenantRef(),
    id: text("id").notNull(),
    refundId: text("refund_id").notNull(),
    orderLineId: text("order_line_id"),
    quantity: integer("quantity").notNull(),
    subtotalCents: integer("subtotal_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const SYNC_STATUSES = ["running", "succeeded", "failed"] as const;

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").$type<(typeof SYNC_STATUSES)[number]>().notNull().default("running"),
    counts: jsonb("counts").$type<Record<string, number>>(),
    error: text("error"),
  },
  (t) => [index("sync_runs_tenant_idx").on(t.tenantId, t.startedAt)],
);

// ---- The agent's audit log (T4). One row per run and one per step. Tool inputs are recorded (they are the model's own
// arguments: dates, filters, ids); prompts, answers and tool results are not.
export const AGENT_SOURCES = ["chat", "eval", "brief", "audit", "playbook"] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];
export const AGENT_RUN_STATUSES = ["running", "ok", "error"] as const;

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    userId: text("user_id").notNull(), // the Clerk user
    role: text("role").notNull(),
    source: text("source").$type<AgentSource>().notNull(),
    modelId: text("model_id").notNull(),
    status: text("status").$type<(typeof AGENT_RUN_STATUSES)[number]>().notNull().default("running"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicros: integer("cost_micros").notNull().default(0), // millionths of a US dollar
    steps: integer("steps").notNull().default(0),
    repaired: boolean("repaired").notNull().default(false), // a repair turn was needed for unmatched numbers
    flaggedNumbers: integer("flagged_numbers").notNull().default(0), // still unmatched after the repair
  },
  (t) => [index("agent_runs_tenant_started_idx").on(t.tenantId, t.startedAt)],
);

export const agentSteps = pgTable(
  "agent_steps",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id),
    tenantId: tenantRef(),
    stepIndex: integer("step_index").notNull(),
    tool: text("tool").notNull(),
    input: jsonb("input").$type<unknown>(),
    ok: boolean("ok").notNull(),
    errorCode: text("error_code"),
    rowCount: integer("row_count"),
    latencyMs: integer("latency_ms").notNull().default(0),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_steps_run_idx").on(t.runId)],
);

// ---- Pace (T6). The plan and the ad spend come from files (fixtures now, an uploaded SOW later), not from Shopify.
// Daily ad spend per channel, in cents. Channels are the ad platforms, not the store's sales channels.
export const adSpend = pgTable(
  "ad_spend",
  {
    tenantId: tenantRef(),
    date: date("date", { mode: "string" }).notNull(),
    channel: text("channel").notNull(),
    spendCents: integer("spend_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.date, t.channel] })],
);

export const PLAN_SOURCES = ["fixture", "upload"] as const;
export type PlanSource = (typeof PLAN_SOURCES)[number];

// A brand has one active plan; a confirmed upload later replaces it (the old one stays, inactive).
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    label: text("label").notNull(), // not "name": the personal-data schema test forbids that column name
    source: text("source").$type<PlanSource>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plans_one_active_per_tenant").on(t.tenantId).where(sql`${t.active}`)],
);

// One monthly target. Money is in cents and a rate is a fraction, the same as the metrics.
export const planTargets = pgTable(
  "plan_targets",
  {
    tenantId: tenantRef(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id),
    month: text("month").notNull(), // YYYY-MM
    metric: text("metric").notNull(),
    value: doublePrecision("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.planId, t.month, t.metric] })],
);

// ---- Saved views, threads and memories (T6).
// A pinned view keeps what re-runs it (the tool and its input), never the data, so it is fresh every time it loads.
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    userId: text("user_id").notNull(), // the Clerk user: pinned views are private to a person
    title: text("title").notNull(),
    component: text("component").notNull(),
    sources: jsonb("sources").$type<ViewSourceRef[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_views_user_idx").on(t.tenantId, t.userId, t.createdAt)],
);

// A conversation. `ui` is the display copy the server built from its own stream (so it holds only what the server produced),
// and the model's history lives in thread_messages, exactly as the provider returned it.
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    ui: jsonb("ui").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("threads_user_idx").on(t.tenantId, t.userId, t.updatedAt)],
);

// The exact provider messages, in order (assistant tool calls, tool results, reasoning blocks and their signatures
// included). `turn` groups one question and everything the model did for it, so history can be cut only between turns.
export const threadMessages = pgTable(
  "thread_messages",
  {
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id),
    tenantId: tenantRef(),
    seq: integer("seq").notNull(),
    turn: integer("turn").notNull(),
    message: jsonb("message").$type<unknown>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.seq] })],
);

export const MEMORY_STATUSES = ["proposed", "confirmed", "dismissed"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

// A fact or preference about a brand. The agent can only propose one; it is used in answers once a person confirms it.
export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    text: text("text").notNull(),
    status: text("status").$type<MemoryStatus>().notNull().default("proposed"),
    proposedBy: text("proposed_by").notNull(), // the Clerk user whose chat produced it
    decidedBy: text("decided_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("memories_status_idx").on(t.tenantId, t.status, t.createdAt)],
);

// ---- Stretch tickets T7-T10. One migration for all of them, so parallel work never clashes on numbering.
// Calendar events and call notes come from fixture files today. Both are text from outside the app: the agent treats them as data.
export const calendarEvents = pgTable(
  "calendar_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    dateFrom: date("date_from", { mode: "string" }).notNull(),
    dateTo: date("date_to", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(), // launch, promo, ...
    channel: text("channel").notNull(),
    details: text("details").notNull().default(""),
  },
  (t) => [index("calendar_events_idx").on(t.tenantId, t.dateFrom)],
);

export const callNotes = pgTable(
  "call_notes",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    heldOn: date("held_on", { mode: "string" }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
  },
  (t) => [index("call_notes_idx").on(t.tenantId, t.heldOn)],
);

export const DOCUMENT_KINDS = ["sow", "plan_sheet", "invoice", "call_note"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_STATUSES = ["uploaded", "read", "confirmed", "discarded"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

// An uploaded SOW or plan sheet. The file itself is not kept: only its text per page, and what was read from it.
// `proposal` holds the targets read from it (each with the sentence and page it came from) until a GC role confirms.
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    kind: text("kind").$type<DocumentKind>().notNull(),
    label: text("label").notNull(), // the file's name as uploaded
    byteSize: integer("byte_size").notNull(),
    pages: jsonb("pages").$type<string[]>().notNull(), // extracted text, one entry per page (one entry for a CSV)
    status: text("status").$type<DocumentStatus>().notNull().default("uploaded"),
    proposal: jsonb("proposal").$type<unknown>(),
    planId: uuid("plan_id").references(() => plans.id), // the plan made when it was confirmed
    uploadedBy: text("uploaded_by").notNull(),
    decidedBy: text("decided_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("documents_idx").on(t.tenantId, t.createdAt)],
);

export const AUDIT_STATUSES = ["draft", "blocked"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

// A growth audit of one brand: fixed checks run in code (`findings`, each with its figures and source query ids) and a write-up
// from the agent loop (`body`). `blocked` means the number checker found a figure no tool result holds. Growth Capital roles only.
export const audits = pgTable(
  "audits",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    status: text("status").$type<AuditStatus>().notNull(),
    body: text("body").notNull(),
    findings: jsonb("findings").$type<unknown>().notNull(),
    unmatched: jsonb("unmatched").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audits_idx").on(t.tenantId, t.createdAt)],
);

export const PLAYBOOK_RUN_STATUSES = ["ready", "blocked"] as const;
export type PlaybookRunStatus = (typeof PLAYBOOK_RUN_STATUSES)[number];

// One run of a playbook (T18) for one brand: a saved sequence of tool calls written up by the agent loop. `blocked` means the
// number checker found a figure no tool result holds. `playbook` is one of the ids in lib/playbooks/definitions.ts and `params`
// holds its validated inputs (a month). Growth Capital roles only.
export const playbookRuns = pgTable(
  "playbook_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    playbook: text("playbook").notNull(),
    params: jsonb("params").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    status: text("status").$type<PlaybookRunStatus>().notNull(),
    body: text("body").notNull(),
    unmatched: jsonb("unmatched").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("playbook_runs_idx").on(t.tenantId, t.playbook, t.createdAt)],
);

export const ACTION_ITEM_STATUSES = ["open", "done"] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

// A follow-up read from a call note and confirmed by a Growth Capital admin or partner: who owns it and when it is due.
// `owner` is a team member's first name or role as written in the note, never a contact detail. `quote` is the sentence it
// came from, checked against the note's text.
export const actionItems = pgTable(
  "action_items",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    title: text("title").notNull(),
    owner: text("owner").notNull(),
    dueOn: date("due_on", { mode: "string" }),
    status: text("status").$type<ActionItemStatus>().notNull().default("open"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id),
    quote: text("quote").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (t) => [index("action_items_idx").on(t.tenantId, t.status, t.dueOn)],
);

export const ACTION_KINDS = ["metric_target", "annotation", "discount_deactivate", "landing_page", "unit_cost_update"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const ACTION_STATUSES = ["proposed", "approved", "running", "done", "failed", "rejected"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

// The action ledger: every write the agent proposes, who approved it, and what happened. `payload` is the exact input the
// executor runs and `payloadHash` is its hash when it was proposed, so a payload changed after approval is refused.
export const actions = pgTable(
  "actions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    kind: text("kind").$type<ActionKind>().notNull(),
    status: text("status").$type<ActionStatus>().notNull().default("proposed"),
    title: text("title").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    diff: jsonb("diff").$type<unknown>().notNull(), // what the approval card shows, built on the server
    hypothesis: text("hypothesis").notNull(),
    metric: text("metric").notNull(),
    checkOn: date("check_on", { mode: "string" }).notNull(), // when to look at whether it worked
    owner: text("owner").notNull(), // the Clerk user who asked for it
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    dryRun: boolean("dry_run").notNull().default(false), // approved by a reviewer login: recorded, never sent to Shopify
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("actions_idx").on(t.tenantId, t.status, t.createdAt)],
);

export const BRIEF_STATUSES = ["draft", "blocked", "approved"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

// A weekly brief for one brand. `blocked` means the number checker found a figure no tool result holds, so it can't be approved.
export const briefs = pgTable(
  "briefs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: tenantRef(),
    weekStart: date("week_start", { mode: "string" }).notNull(), // the Monday it covers from
    status: text("status").$type<BriefStatus>().notNull(),
    body: text("body").notNull(),
    unmatched: jsonb("unmatched").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    delivered: boolean("delivered").notNull().default(false), // true once it has been handed to the delivery function (the log today)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("briefs_one_per_week").on(t.tenantId, t.weekStart)],
);
