-- Sharing (course grants) as a second way to see a course's rows, checked by
-- row-level security like workspace membership. Every request's transaction
-- sets, besides app.tenant_ids and app.staff (0001), for that transaction only:
--   app.course_ids  courses the user was granted (comma-separated uuids;
--                   only grants that are effective right now, lib/authz/identity.ts)
-- A grant reaches exactly one course: its rows, never the rest of its workspace.

CREATE FUNCTION editor_course_visible(tenant uuid, course uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT editor_tenant_visible(tenant)
      OR course = ANY (string_to_array(nullif(current_setting('app.course_ids', true), ''), ',')::uuid[])
$$;
--> statement-breakpoint
DROP POLICY courses_tenant_isolation ON courses;
--> statement-breakpoint
CREATE POLICY courses_isolation ON courses
  USING (editor_course_visible(tenant_id, id))
  WITH CHECK (editor_course_visible(tenant_id, id));
--> statement-breakpoint
DROP POLICY lessons_tenant_isolation ON lessons;
--> statement-breakpoint
CREATE POLICY lessons_isolation ON lessons
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
--> statement-breakpoint
DROP POLICY course_revisions_tenant_isolation ON course_revisions;
--> statement-breakpoint
CREATE POLICY course_revisions_isolation ON course_revisions
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
--> statement-breakpoint
DROP POLICY lesson_snapshots_tenant_isolation ON lesson_snapshots;
--> statement-breakpoint
CREATE POLICY lesson_snapshots_isolation ON lesson_snapshots
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
--> statement-breakpoint
DROP POLICY revision_lessons_tenant_isolation ON revision_lessons;
--> statement-breakpoint
CREATE POLICY revision_lessons_isolation ON revision_lessons
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
--> statement-breakpoint
DROP POLICY course_reviews_tenant_isolation ON course_reviews;
--> statement-breakpoint
CREATE POLICY course_reviews_isolation ON course_reviews
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
