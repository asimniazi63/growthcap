CREATE TABLE "ad_spend" (
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"channel" text NOT NULL,
	"spend_cents" integer NOT NULL,
	CONSTRAINT "ad_spend_tenant_id_date_channel_pk" PRIMARY KEY("tenant_id","date","channel")
);
--> statement-breakpoint
CREATE TABLE "plan_targets" (
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"month" text NOT NULL,
	"metric" text NOT NULL,
	"value" double precision NOT NULL,
	CONSTRAINT "plan_targets_tenant_id_plan_id_month_metric_pk" PRIMARY KEY("tenant_id","plan_id","month","metric")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_spend" ADD CONSTRAINT "ad_spend_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_targets" ADD CONSTRAINT "plan_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_targets" ADD CONSTRAINT "plan_targets_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_active_per_tenant" ON "plans" USING btree ("tenant_id") WHERE "plans"."active";