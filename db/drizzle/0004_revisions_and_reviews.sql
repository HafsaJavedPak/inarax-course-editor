CREATE TABLE "course_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"submitted_revision_id" uuid NOT NULL,
	"submitted_hash" text NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"decision" text,
	"decided_revision_id" uuid,
	"decided_hash" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"invalidated_by_revision_id" uuid
);
--> statement-breakpoint
CREATE TABLE "course_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"parent_id" uuid,
	"kind" text NOT NULL,
	"label" text,
	"content_hash" text NOT NULL,
	"course_data" jsonb NOT NULL,
	"actors" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" jsonb,
	"restored_from" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sealed_at" timestamp with time zone,
	CONSTRAINT "course_revisions_course_number_key" UNIQUE("course_id","number")
);
--> statement-breakpoint
CREATE TABLE "lesson_snapshots" (
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"hash" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_snapshots_course_id_hash_pk" PRIMARY KEY("course_id","hash")
);
--> statement-breakpoint
CREATE TABLE "revision_lessons" (
	"revision_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "revision_lessons_revision_id_lesson_id_pk" PRIMARY KEY("revision_id","lesson_id")
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "head_hash" text;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "head_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "published_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "course_reviews" ADD CONSTRAINT "course_reviews_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_revisions" ADD CONSTRAINT "course_revisions_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_snapshots" ADD CONSTRAINT "lesson_snapshots_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_lessons" ADD CONSTRAINT "revision_lessons_revision_id_course_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."course_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_lessons" ADD CONSTRAINT "revision_lessons_snapshot_fk" FOREIGN KEY ("course_id","hash") REFERENCES "public"."lesson_snapshots"("course_id","hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_reviews_course_idx" ON "course_reviews" USING btree ("course_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "course_reviews_one_open_idx" ON "course_reviews" USING btree ("course_id") WHERE "course_reviews"."decision" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "course_revisions_one_open_idx" ON "course_revisions" USING btree ("course_id") WHERE "course_revisions"."sealed_at" IS NULL;