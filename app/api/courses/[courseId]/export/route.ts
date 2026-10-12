import { courseForRoute } from "@/lib/authz/context"
import { exportCourses, slugify, today, zipResponse } from "@/lib/course-export"

/** Download one course (course.json, lessons, images) as a zip. */
export async function GET(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/export">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.export")
  if (!loaded.ok) return loaded.error

  const zip = await exportCourses(loaded.ctx, [loaded.record.course])
  return zipResponse(zip, `inara-${slugify(loaded.record.course.title)}-${today()}.zip`)
}
