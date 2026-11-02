CREATE TABLE "cost_assumptions" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"card_fee_bps" integer NOT NULL,
	"card_fee_fixed_cents" integer NOT NULL,
	"fulfilment_cents_per_order" integer NOT NULL,
	"source" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operating_costs" (
	"tenant_id" uuid NOT NULL,
	"month" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"source" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operating_costs_tenant_id_month_category_pk" PRIMARY KEY("tenant_id","month","category")
);
--> statement-breakpoint
ALTER TABLE "cost_assumptions" ADD CONSTRAINT "cost_assumptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_costs" ADD CONSTRAINT "operating_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;