-- Row-level security: the second wall between tenants (the first is the
-- tenant filter in lib/db/tenant-db.ts).
--
-- Every request runs in a transaction that sets, for that transaction only:
--   app.tenant_ids  the tenants the signed-in user belongs to (comma-separated uuids)
--   app.staff       'on' for platform admins, who review personal workspaces
-- Rows of any other tenant are invisible and can't be written, even by a
-- query that forgets its tenant filter. With nothing set, nothing is visible.
--
-- FORCE applies the policies to the table owner too (the app connects as the
-- owner). Superusers always bypass RLS, so production must not connect as one.

CREATE FUNCTION editor_tenant_visible(tenant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT tenant = ANY (string_to_array(nullif(current_setting('app.tenant_ids', true), ''), ',')::uuid[])
      OR (coalesce(current_setting('app.staff', true), '') = 'on'
          AND EXISTS (SELECT 1 FROM tenants WHERE tenants.id = tenant AND tenants.kind = 'personal'))
$$;
--> statement-breakpoint
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE courses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY courses_tenant_isolation ON courses
  USING (editor_tenant_visible(tenant_id))
  WITH CHECK (editor_tenant_visible(tenant_id));
--> statement-breakpoint
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE lessons FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lessons_tenant_isolation ON lessons
  USING (editor_tenant_visible(tenant_id))
  WITH CHECK (editor_tenant_visible(tenant_id));
