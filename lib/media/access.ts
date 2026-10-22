import "server-only"

import { resourceOf, type RequestContext } from "@/lib/authz/context"
import { can, canInTenant } from "@/lib/authz/policy"
import { findCourse } from "@/lib/course-store"
import { WORKSPACE_SCOPE, type UploadRef } from "@/lib/uploads"

// Who may read or add a file (R1): the rule behind app/uploads/[...path] and /api/uploads.
// A file belongs to a workspace, and to a course in it; it is shown to whoever may read that
// course (its author, org admins, reviewers, people it was shared with) and to nobody else.

/** May this person load the file? A legacy file (no tenant) only needs a signed-in session until it is migrated. */
export async function mayReadUpload(ctx: RequestContext, ref: UploadRef): Promise<boolean> {
  if (!ref.tenantId || !ref.scope) return true
  if (ref.scope === WORKSPACE_SCOPE) return ctx.staff || ctx.tenantIds.includes(ref.tenantId)
  const record = await findCourse(ctx, ref.scope)
  return !!record && record.tenantId === ref.tenantId && can(ctx, "course.read", resourceOf(record))
}

export type UploadTarget = { ok: true; tenantId: string; scope: string } | { ok: false; status: 400 | 403 | 404; error: string }

/**
 * Where a new file goes, for `?course=<id>` (a file for that course: the person must be able to edit it
 * or change its settings) or `?workspace=<id>` (a file made before the course exists).
 */
export async function uploadTarget(ctx: RequestContext, query: { course?: string | null; workspace?: string | null }): Promise<UploadTarget> {
  if (query.course) {
    const record = await findCourse(ctx, query.course)
    if (!record || !can(ctx, "course.read", resourceOf(record))) return { ok: false, status: 404, error: "Course not found" }
    const resource = resourceOf(record)
    if (!can(ctx, "course.edit", resource) && !can(ctx, "course.settings", resource)) {
      return { ok: false, status: 403, error: "You don't have permission to add files to this course." }
    }
    return { ok: true, tenantId: record.tenantId, scope: record.course.id }
  }
  if (query.workspace) {
    if (!canInTenant(ctx, "course.create", query.workspace)) return { ok: false, status: 404, error: "Workspace not found" }
    return { ok: true, tenantId: query.workspace, scope: WORKSPACE_SCOPE }
  }
  return { ok: false, status: 400, error: "Say where the file belongs: ?course=<id> or ?workspace=<id>." }
}
