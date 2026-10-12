import { z } from "zod"

import { courseForRoute, editsAsReviewer } from "@/lib/authz/context"
import { CourseSchema } from "@/lib/course"
import {
  ApprovedLockedError,
  CourseLockedError,
  deleteCourse,
  getCourseReport,
  RevisionConflictError,
  saveCourseContent,
} from "@/lib/course-store"
import { audit } from "@/lib/authz/identity"
import { getPlatform, PLATFORM_ERROR_STATUS, PlatformError } from "@/lib/platform"

type Ctx = RouteContext<"/api/courses/[courseId]">

export async function GET(_req: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error
  return Response.json({ course: loaded.record.course, report: await getCourseReport(loaded.ctx, loaded.record.course) })
}

/**
 * Save course content (body: the full course with the revision the client
 * loaded). Status, owner and review fields in the body are ignored.
 */
export async function PUT(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.edit")
  if (!loaded.ok) return loaded.error

  const parsed = CourseSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || parsed.data.id !== courseId) {
    return Response.json(
      { error: "Invalid course", issues: parsed.success ? [] : z.flattenError(parsed.error) },
      { status: 400 }
    )
  }
  try {
    const asReviewer = await editsAsReviewer(loaded.ctx, loaded.record)
    const course = await saveCourseContent(loaded.ctx, parsed.data, { id: loaded.ctx.userId, asReviewer })
    return Response.json({ course, report: await getCourseReport(loaded.ctx, course) })
  } catch (e) {
    if (e instanceof RevisionConflictError || e instanceof CourseLockedError || e instanceof ApprovedLockedError) {
      return Response.json({ error: e.message }, { status: 409 })
    }
    throw e
  }
}

/** Delete a course and its lessons: reviewers any time, authors unless it's in review. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.delete")
  if (!loaded.ok) return loaded.error
  if (loaded.record.course.status === "in_review" && !(await editsAsReviewer(loaded.ctx, loaded.record))) {
    return Response.json({ error: "Withdraw the course from review before deleting it." }, { status: 409 })
  }

  // Off the platform first: if that fails the course stays here too, so it can't
  // be left live on the platform with no way to manage it from the editor.
  try {
    await getPlatform()?.deleteCourse(courseId)
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error
    console.error(`Failed to delete course ${courseId} on the platform:`, error.message, error.detail)
    return Response.json(
      { error: `Couldn't delete the course on the platform, so it wasn't deleted here either: ${error.message}` },
      { status: PLATFORM_ERROR_STATUS[error.kind] },
    )
  }
  await deleteCourse(loaded.ctx, courseId)
  await audit({ actorId: loaded.ctx.userId, action: "course.delete", tenantId: loaded.record.tenantId, courseId, target: courseId })
  return new Response(null, { status: 204 })
}
