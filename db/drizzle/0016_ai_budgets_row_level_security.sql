-- The AI spend ledger (04 · C2) is tenant-scoped — a budget belongs to a whole
-- workspace, not one course — so it is protected by editor_tenant_visible(),
-- like courses/lessons in 0001. A member of the workspace (or platform staff)
-- may read and write it. A guest granted one of the workspace's courses may
-- also spend for that workspace (they can request AI jobs on the shared course),
-- so editor_tenant_budget_visible() adds that: a course grant in app.course_ids
-- opens the workspace's ledger, checked the same way editor_course_visible()
-- opens a course's rows (0007).

CREATE FUNCTION editor_tenant_budget_visible(tenant uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT editor_tenant_visible(tenant)
      OR EXISTS (
        SELECT 1 FROM courses c
        WHERE c.tenant_id = tenant
          AND c.id = ANY (string_to_array(nullif(current_setting('app.course_ids', true), ''), ',')::uuid[])
      )
$$;
--> statement-breakpoint
ALTER TABLE tenant_ai_budgets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_ai_budgets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_ai_budgets_isolation ON tenant_ai_budgets
  USING (editor_tenant_budget_visible(tenant_id))
  WITH CHECK (editor_tenant_budget_visible(tenant_id));
