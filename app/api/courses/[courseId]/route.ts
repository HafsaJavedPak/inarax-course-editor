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
  await deleteCourse(courseId)
  return new Response(null, { status: 204 })
}
