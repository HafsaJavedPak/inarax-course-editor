-- Row-level security for history and review rounds: the same rule as
-- courses and lessons (0001_row_level_security.sql). A request only sees
-- rows of the tenants it was scoped to, even if a query forgets its filter.

ALTER TABLE course_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE course_revisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY course_revisions_tenant_isolation ON course_revisions
  USING (editor_tenant_visible(tenant_id))
  WITH CHECK (editor_tenant_visible(tenant_id));
--> statement-breakpoint
ALTER TABLE lesson_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lesson_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lesson_snapshots_tenant_isolation ON lesson_snapshots
  USING (editor_tenant_visible(tenant_id))
  WITH CHECK (editor_tenant_visible(tenant_id));
--> statement-breakpoint
ALTER TABLE revision_lessons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE revision_lessons FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY revision_lessons_tenant_isolation ON revision_lessons
  USING (editor_tenant_visible(tenant_id))
  WITH CHECK (editor_tenant_visible(tenant_id));
--> statement-breakpoint
ALTER TABLE course_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE course_reviews FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY course_reviews_tenant_isolation ON course_reviews
  USING (editor_tenant_visible(tenant_id))
  WITH CHECK (editor_tenant_visible(tenant_id));
