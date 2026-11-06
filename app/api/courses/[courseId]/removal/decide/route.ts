import { z } from "zod"

import { flushLiveCourse, LiveFlushError } from "@/lib/collab/live"
import { notifyCourseDeleted } from "@/lib/collab/notify"
import { courseForRoute } from "@/lib/authz/context"
import { audit } from "@/lib/authz/identity"
import { removeCourse, takeDownCourse } from "@/lib/course-store"
import { takedown } from "@/lib/course-status"
import { getPlatform, PLATFORM_ERROR_STATUS, PlatformError } from "@/lib/platform"
import { RemovalDecisionSchema } from "@/lib/removal/rules"
import { decideRemovalRequest, pendingRemovalRequest } from "@/lib/removal/store"
import { publishedWorkflowResponse, workflowResponse } from "@/lib/workflow-response"

type Ctx = RouteContext<"/api/courses/[courseId]/removal/decide">

/**
 * A platform admin's decision on the pending removal request. Body: { decision: "approved" | "declined", note }.
 * Approving a take-down takes the live course down (and tells the platform, as this admin); approving a removal archives
 * it on the platform and hides it here, deleting nothing. Declining keeps it live and tells the requester why. If the
 * platform can't be reached the request stays pending, so nothing is half done.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.removal.decide")
  if (!loaded.ok) return loaded.error
  const { ctx: access, record } = loaded

  const parsed = RemovalDecisionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid decision", issues: z.flattenError(parsed.error) }, { status: 400 })
  const { decision, note } = parsed.data

  const pending = await pendingRemovalRequest(access, courseId)
  if (!pending) return Response.json({ error: "There is no open request for this course.", code: "none_pending" }, { status: 409 })

  if (decision === "declined") {
    const declined = await decideRemovalRequest(access, courseId, access.userId, "declined", note)
    if (!declined) return Response.json({ error: "There is no open request for this course.", code: "none_pending" }, { status: 409 })
    await audit({ actorId: access.userId, action: "course.removal.decline", tenantId: record.tenantId, courseId, target: pending.kind, detail: { note } })
    return Response.json({ request: declined })
  }

  if (pending.kind === "takedown") {
    // Edits not yet stored go first, so the course is taken down as it was last saved.
    try {
      await flushLiveCourse(courseId)
    } catch (error) {
      if (error instanceof LiveFlushError) return Response.json({ error: error.message }, { status: 503 })
      throw error
    }
    const result = await takeDownCourse(access, courseId, access.userId, (current) => takedown(current, access.userId, note || pending.reason))
    if (!result || "error" in result) return workflowResponse(result)
    await decideRemovalRequest(access, courseId, access.userId, "approved", note)
    await audit({ actorId: access.userId, action: "course.removal.approve", tenantId: record.tenantId, courseId, target: "takedown", detail: { note } })
    return publishedWorkflowResponse(access, result)
  }

  // Remove from view: off the platform first (archived there), so it can't stay live with no way to manage it from here.
  try {
    await getPlatform()?.deleteCourse(courseId, { id: access.userId })
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error
    console.error(`Failed to remove course ${courseId} on the platform:`, error.message, error.detail)
    return Response.json(
      { error: `Couldn't remove the course on the platform, so it wasn't removed here either: ${error.message}` },
      { status: PLATFORM_ERROR_STATUS[error.kind] },
    )
  }
  await decideRemovalRequest(access, courseId, access.userId, "approved", note)
  await removeCourse(access, courseId, access.userId)
  await notifyCourseDeleted(courseId)
  await audit({ actorId: access.userId, action: "course.removal.approve", tenantId: record.tenantId, courseId, target: "delete", detail: { note } })
  return Response.json({ removed: true })
}
