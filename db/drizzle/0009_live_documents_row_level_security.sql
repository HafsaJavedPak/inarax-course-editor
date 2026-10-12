-- Live documents follow the same row-level security as the course they belong
-- to (editor_course_visible: its workspace, or a grant on the course).

ALTER TABLE collab_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE collab_documents FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY collab_documents_isolation ON collab_documents
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
--> statement-breakpoint
ALTER TABLE collab_updates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE collab_updates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY collab_updates_isolation ON collab_updates
  USING (editor_course_visible(tenant_id, course_id))
  WITH CHECK (editor_course_visible(tenant_id, course_id));
