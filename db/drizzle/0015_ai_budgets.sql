CREATE TABLE "tenant_ai_budgets" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"reserved" numeric(12, 4) DEFAULT '0' NOT NULL,
	"spent" numeric(12, 4) DEFAULT '0' NOT NULL,
	"period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_ai_budgets" ADD CONSTRAINT "tenant_ai_budgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
