import { z } from "zod"

import { courseForRoute, editsAsReviewer } from "@/lib/authz/context"
import { audit } from "@/lib/authz/identity"
import { ApprovedLockedError, CourseLockedError, HeadMovedError, restoreRevision } from "@/lib/course-store"
import { idempotent } from "@/lib/http/idempotency"
import { isUuid } from "@/lib/lesson"

const RestoreSchema = z.object({
  /** The newest revision the history showed; if the course changed since, nothing is restored (409). */
  expected_head: z.uuid(),
})

/**
 * Restores an earlier revision by writing its content forward as a new
 * revision. Nothing in the history is removed. Send an Idempotency-Key so a
 * retried request doesn't restore twice.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/courses/[courseId]/revisions/[revisionId]/restore">) {
  const { courseId, revisionId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.restore")
  if (!loaded.ok) return loaded.error
  if (!isUuid(revisionId)) return Response.json({ error: "Revision not found" }, { status: 404 })
  const { ctx: access, record } = loaded

  return idempotent(request, access.userId, async (body) => {
    const parsed = RestoreSchema.safeParse(JSON.parse(body || "null"))
    if (!parsed.success) return Response.json({ error: "Say which version the history showed (expected_head)." }, { status: 400 })
    try {
      const editor = { id: access.userId, asReviewer: await editsAsReviewer(access, record) }
      const restored = await restoreRevision(access, courseId, revisionId, parsed.data.expected_head, editor)
      if (!restored) return Response.json({ error: "Revision not found" }, { status: 404 })
      await audit({
        actorId: access.userId,
        action: "revision.restore",
        tenantId: record.tenantId,
        courseId,
        target: restored.revision.id,
        detail: { restored_from: revisionId, revision: restored.revision.number },
      })
      return Response.json({ course: restored.course, revision: { id: restored.revision.id, number: restored.revision.number } })
    } catch (error) {
      if (error instanceof HeadMovedError) {
        return Response.json({ error: error.message, code: "head_moved", head: error.headRevisionId }, { status: 409 })
      }
      if (error instanceof CourseLockedError || error instanceof ApprovedLockedError) {
        return Response.json({ error: error.message }, { status: 409 })
      }
      throw error
    }
  })
}
