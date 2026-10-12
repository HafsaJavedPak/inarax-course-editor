CREATE TABLE "collab_documents" (
	"name" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"state" "bytea" NOT NULL,
	"state_seq" bigint DEFAULT 0 NOT NULL,
	"attention" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_updates" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "collab_updates_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"update" "bytea" NOT NULL,
	"actor_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collab_documents" ADD CONSTRAINT "collab_documents_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collab_updates" ADD CONSTRAINT "collab_updates_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collab_documents_course_idx" ON "collab_documents" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "collab_updates_name_seq_idx" ON "collab_updates" USING btree ("name","seq");