-- Platform staff review and publish courses in every workspace, organizations
-- included, so they may read and manage any tenant's courses. This replaces
-- the 0001 definition of editor_tenant_visible(), which limited staff to
-- personal workspaces.
--
-- Non-staff are unaffected: their rows are still limited to the workspaces
-- they belong to (app.tenant_ids) or a course shared with them (app.course_ids,
-- editor_course_visible). With nothing set, nothing is visible.

CREATE OR REPLACE FUNCTION editor_tenant_visible(tenant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT tenant = ANY (string_to_array(nullif(current_setting('app.tenant_ids', true), ''), ',')::uuid[])
      OR coalesce(current_setting('app.staff', true), '') = 'on'
$$;
