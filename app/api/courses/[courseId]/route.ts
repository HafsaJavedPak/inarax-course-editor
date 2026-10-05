import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { CourseSchema } from "@/lib/course"
import {
  CourseLockedError,
  deleteCourse,
  getAccessibleCourse,
  getCourseReport,
  RevisionConflictError,
  saveCourseContent,
} from "@/lib/course-store"
import { getPlatform, PLATFORM_ERROR_STATUS, PlatformError } from "@/lib/platform"

type Ctx = RouteContext<"/api/courses/[courseId]">

const notFound = () => Response.json({ error: "Course not found" }, { status: 404 })

export async function GET(_req: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const course = await getAccessibleCourse(courseId, await getCurrentUser())
  if (!course) return notFound()
  return Response.json({ course, report: await getCourseReport(course) })
}

/**
 * Save course content (body: the full course with the revision the client
 * loaded). Status, owner and review fields in the body are ignored.
 */
export async function PUT(request: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const user = await getCurrentUser()
  if (!(await getAccessibleCourse(courseId, user))) return notFound()

  const parsed = CourseSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || parsed.data.id !== courseId) {
    return Response.json(
      { error: "Invalid course", issues: parsed.success ? [] : z.flattenError(parsed.error) },
      { status: 400 }
    )
  }
  try {
    const course = await saveCourseContent(parsed.data, user)
    return Response.json({ course, report: await getCourseReport(course) })
  } catch (e) {
    if (e instanceof RevisionConflictError || e instanceof CourseLockedError) {
      return Response.json({ error: e.message }, { status: 409 })
    }
    throw e
  }
}

/** Delete a course and its lessons: admins any time, owners unless it's in review. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { courseId } = await ctx.params
  const user = await getCurrentUser()
  const course = await getAccessibleCourse(courseId, user)
  if (!course) return notFound()
  if (user.role !== "admin" && course.status === "in_review") {
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
  await deleteCourse(courseId)
  return new Response(null, { status: 204 })
}
