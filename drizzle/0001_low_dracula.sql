CREATE TABLE "customers" (
	"tenant_id" uuid NOT NULL,
	"id" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "customers_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "inventory_levels" (
	"tenant_id" uuid NOT NULL,
	"variant_id" text NOT NULL,
	"location_id" text NOT NULL,
	"location_name" text DEFAULT '' NOT NULL,
	"available" integer NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_levels_tenant_id_variant_id_location_id_pk" PRIMARY KEY("tenant_id","variant_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"tenant_id" uuid NOT NULL,
	"id" text NOT NULL,
	"order_id" text NOT NULL,
	"variant_id" text,
	"product_id" text,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	CONSTRAINT "order_lines_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"tenant_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"customer_id" text,
	"gross_cents" integer NOT NULL,
	"discount_cents" integer NOT NULL,
	"shipping_cents" integer NOT NULL,
	"discount_code" text,
	"channel" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"cancelled_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"tenant_id" uuid NOT NULL,
	"id" text NOT NULL,
	"title" text NOT NULL,
	"handle" text NOT NULL,
	"status" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "refund_lines" (
	"tenant_id" uuid NOT NULL,
	"id" text NOT NULL,
	"refund_id" text NOT NULL,
	"order_line_id" text,
	"quantity" integer NOT NULL,
	"subtotal_cents" integer NOT NULL,
	CONSTRAINT "refund_lines_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"tenant_id" uuid NOT NULL,
	"id" text NOT NULL,
	"order_id" text NOT NULL,
	"processed_at" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	CONSTRAINT "refunds_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"counts" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"tenant_id" uuid NOT NULL,
	"id" text NOT NULL,
	"product_id" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"price_cents" integer NOT NULL,
	"unit_cost_cents" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variants_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_lines" ADD CONSTRAINT "refund_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("tenant_id","order_id");--> statement-breakpoint
CREATE INDEX "orders_local_date_idx" ON "orders" USING btree ("tenant_id","local_date");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "refunds_local_date_idx" ON "refunds" USING btree ("tenant_id","local_date");--> statement-breakpoint
CREATE INDEX "sync_runs_tenant_idx" ON "sync_runs" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "variants" USING btree ("tenant_id","product_id");