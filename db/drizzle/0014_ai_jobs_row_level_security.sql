-- AI jobs (04 · AI and media generation, C1) under the same rule as every other
-- course-scoped table: a job is visible when its course is — a member of its
-- workspace, platform staff, or a grant — checked by row-level security, not
-- just by the application filter. lib/db/tenant-db.ts sets app.tenant_ids,
-- app.staff and app.course_ids per transaction; editor_course_visible() is the
-- same function every other course-scoped table uses (0007).

ALTER TABLE ai_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_jobs_isolation ON ai_jobs
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
--> statement-breakpoint
ALTER TABLE ai_job_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_job_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_job_attempts_isolation ON ai_job_attempts
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
