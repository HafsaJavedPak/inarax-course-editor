-- Review has two stages now (lib/review/pipeline.ts). `approved` used to mean
-- "live"; it now means "passed the organization, waiting for the platform", and
-- `published` means live. Every course stored as `approved` was live, so it
-- becomes `published` and stays live. Run the host's migrations and deploy it
-- first: the host reads `approved` in a pre-2.2 package as live, so nothing
-- changes for learners in between.
--
-- Row-level security applies to the migrating role too (FORCE), so the update
-- runs as platform staff, who see every workspace. The setting is reset after.

SELECT set_config('app.staff', 'on', false);--> statement-breakpoint
UPDATE "courses"
SET "status" = 'published', "data" = jsonb_set("data", '{status}', '"published"')
WHERE "status" = 'approved';--> statement-breakpoint
SELECT set_config('app.staff', '', false);
