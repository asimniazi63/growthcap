CREATE TABLE "compliance_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_domain" text NOT NULL,
	"topic" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shop_domain" text NOT NULL,
	"token_enc" jsonb,
	"refresh_token_enc" jsonb,
	"expires_at" timestamp with time zone,
	"scopes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"timezone" text NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_org_id_unique" UNIQUE("org_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" text NOT NULL,
	"topic" text NOT NULL,
	"shop_domain" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_events_webhook_id_unique" UNIQUE("webhook_id")
);
--> statement-breakpoint
ALTER TABLE "shop_connections" ADD CONSTRAINT "shop_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shop_connections_shop_domain_key" ON "shop_connections" USING btree ("shop_domain");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_connections_one_connected_per_tenant" ON "shop_connections" USING btree ("tenant_id") WHERE "shop_connections"."status" = 'connected';--> statement-breakpoint
CREATE INDEX "webhook_events_shop_domain_idx" ON "webhook_events" USING btree ("shop_domain");