ALTER TABLE "courses" ADD COLUMN "sample" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sample_course_at" timestamp with time zone;