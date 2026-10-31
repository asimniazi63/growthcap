import { sql } from "drizzle-orm";
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { EncryptedSecret } from "../crypto/secrets";

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
export const AGENT_SOURCES = ["chat", "eval"] as const;
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
