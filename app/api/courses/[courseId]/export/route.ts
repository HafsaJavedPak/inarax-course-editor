import { exportCourses, slugify, today, zipResponse } from "@/lib/course-export"
import { readCourse } from "@/lib/course-store"

/** Download one course (course.json, lessons, images) as a zip. */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/export">) {
  const { courseId } = await ctx.params
  const course = await readCourse(courseId)
  if (!course) return Response.json({ error: "Course not found" }, { status: 404 })

  const zip = await exportCourses([course.id])
  return zipResponse(zip, `inara-${slugify(course.title)}-${today()}.zip`)
}
