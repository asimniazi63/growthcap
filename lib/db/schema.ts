import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
