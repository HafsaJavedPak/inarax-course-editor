import { getCurrentUser } from "@/lib/auth"
import { isLocked } from "@/lib/course-status"
import { getAccessibleCourse } from "@/lib/course-store"
import { publishAndRecord } from "@/lib/workflow-response"

/**
 * Publish the course as saved on disk (structure and every saved lesson) to
 * the configured platform (lib/platform). The editors save locally first,
 * then call this.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/publish">) {
  const { courseId } = await ctx.params
  const user = await getCurrentUser()
  const course = await getAccessibleCourse(courseId, user)
  if (!course) return Response.json({ error: "Course not found" }, { status: 404 })
  if (isLocked(course.status) && user.role !== "admin") {
    return Response.json({ error: "This course is in review and can't be published. Withdraw it first." }, { status: 409 })
  }

  const result = await publishAndRecord(course, user.id)
  if ("error" in result) return Response.json({ error: result.error, code: result.code, issues: result.issues }, { status: result.status })
  return Response.json(result)
}
