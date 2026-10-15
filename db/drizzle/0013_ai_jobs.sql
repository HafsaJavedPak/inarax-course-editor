CREATE TABLE "ai_job_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ai_job_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"worker" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" text,
	"error" jsonb,
	"cost" numeric(12, 4)
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid,
	"block_id" uuid,
	"field" text,
	"kind" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_revision_id" uuid NOT NULL,
	"base_content_hash" text NOT NULL,
	"base_lesson_hash" text,
	"provider" text NOT NULL,
	"model" text,
	"prompt_version" text NOT NULL,
	"estimated_cost" numeric(12, 4),
	"reserved_cost" numeric(12, 4),
	"actual_cost" numeric(12, 4),
	"currency" text DEFAULT 'USD' NOT NULL,
	"budget_status" text DEFAULT 'none' NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" jsonb,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"result" jsonb,
	"provenance" jsonb,
	"claimed_by" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"accepted_revision_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"created_by" text NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_job_attempts" ADD CONSTRAINT "ai_job_attempts_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_job_attempts" ADD CONSTRAINT "ai_job_attempts_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_job_attempts_job_idx" ON "ai_job_attempts" USING btree ("job_id","attempt");--> statement-breakpoint
CREATE INDEX "ai_jobs_claimable_idx" ON "ai_jobs" USING btree ("created_at") WHERE "ai_jobs"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "ai_jobs_course_idx" ON "ai_jobs" USING btree ("course_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_target_idx" ON "ai_jobs" USING btree ("course_id","block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_one_live_per_target_idx" ON "ai_jobs" USING btree ("course_id","kind","base_revision_id",coalesce("lesson_id"::text, ''),coalesce("block_id"::text, '')) WHERE "ai_jobs"."state" in ('queued', 'running', 'validating', 'ready');