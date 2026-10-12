CREATE TABLE "idempotency_keys" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"response_body" text,
	"response_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "course_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "trace_id" text;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "hash" text;--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_course_at_idx" ON "audit_log" USING btree ("course_id","created_at");