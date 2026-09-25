import { z } from "zod"
import { CourseSchema } from "@/lib/course"
import { getCourseReport, readCourse, RevisionConflictError, saveCourse } from "@/lib/course-store"

export async function GET(_req: Request, ctx: RouteContext<"/api/courses/[courseId]">) {
  const { courseId } = await ctx.params
  const course = await readCourse(courseId)
  if (!course) return Response.json({ error: "Course not found" }, { status: 404 })
  return Response.json({ course, report: await getCourseReport(course) })
}

/** Body: the full course (with the revision the client loaded). */
export async function PUT(request: Request, ctx: RouteContext<"/api/courses/[courseId]">) {
  const { courseId } = await ctx.params
  const parsed = CourseSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || parsed.data.id !== courseId) {
    return Response.json(
      { error: "Invalid course", issues: parsed.success ? [] : z.flattenError(parsed.error) },
      { status: 400 }
    )
  }
  try {
    const course = await saveCourse(parsed.data)
    return Response.json({ course, report: await getCourseReport(course) })
  } catch (e) {
    if (e instanceof RevisionConflictError) return Response.json({ error: e.message }, { status: 409 })
    throw e
  }
}
