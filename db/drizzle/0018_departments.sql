-- Departments: scopes inside an organization workspace (flat, no nesting). The
-- host owns them; the editor mirrors them at sign-in, like memberships, so these
-- two tables sit outside row-level security with the other identity tables.
-- A course may belong to one department; it is a plain column, not part of the
-- course's content, so changing it never touches revisions or approvals.
-- Deleting a department leaves its courses with the whole organization.

CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"host_department_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_host_department_id_unique" UNIQUE("host_department_id")
);
--> statement-breakpoint
CREATE TABLE "department_memberships" (
	"department_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "department_memberships_department_id_user_id_pk" PRIMARY KEY("department_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "departments_tenant_idx" ON "departments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "department_memberships_user_idx" ON "department_memberships" USING btree ("user_id");
