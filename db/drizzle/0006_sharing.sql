CREATE TABLE "course_grants" (
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_grants_course_id_user_id_pk" PRIMARY KEY("course_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "course_invitation_deliveries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "course_invitation_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"invitation_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "course_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "course_grants" ADD CONSTRAINT "course_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_grants" ADD CONSTRAINT "course_grants_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_invitation_deliveries" ADD CONSTRAINT "course_invitation_deliveries_invitation_id_course_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."course_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_invitations" ADD CONSTRAINT "course_invitations_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_grants_user_idx" ON "course_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "course_invitation_deliveries_invitation_idx" ON "course_invitation_deliveries" USING btree ("invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_invitations_one_pending_idx" ON "course_invitations" USING btree ("course_id","email") WHERE "course_invitations"."accepted_at" IS NULL AND "course_invitations"."revoked_at" IS NULL;