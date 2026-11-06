-- Removing a course never deletes it (courses.removed_at / removed_by: hidden, rows and history kept), and a live
-- course comes down only when a platform admin approves a request (removal_requests). Plain columns and a new table:
-- nothing here is part of a course's content, so revisions and approvals are untouched.

ALTER TABLE "courses" ADD COLUMN "removed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "removed_by" text;
--> statement-breakpoint
CREATE TABLE "removal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	CONSTRAINT "removal_requests_kind_check" CHECK ("kind" IN ('takedown', 'delete')),
	CONSTRAINT "removal_requests_state_check" CHECK ("state" IN ('pending', 'approved', 'declined', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "removal_requests" ADD CONSTRAINT "removal_requests_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "removal_requests_course_idx" ON "removal_requests" USING btree ("course_id","requested_at");
--> statement-breakpoint
CREATE INDEX "removal_requests_pending_idx" ON "removal_requests" USING btree ("requested_at") WHERE "removal_requests"."state" = 'pending';
--> statement-breakpoint
CREATE UNIQUE INDEX "removal_requests_one_pending_idx" ON "removal_requests" USING btree ("course_id") WHERE "removal_requests"."state" = 'pending';
--> statement-breakpoint
-- Row-level security, as for every course-scoped table: visible when its course is (a member of its workspace,
-- platform staff, or a grant), checked in the database as well as by the application filter (0007, 0014).
ALTER TABLE "removal_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "removal_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY removal_requests_isolation ON "removal_requests"
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
