import { courseForRoute, editsAsReviewer } from "@/lib/authz/context"
import { isLocked } from "@/lib/course-status"
import { publishAndRecord } from "@/lib/workflow-response"

/**
 * Publish the course as saved (structure and every saved lesson) to the
 * configured platform (lib/platform). The editors save first, then call this.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/publish">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.publish")
  if (!loaded.ok) return loaded.error
  const { ctx: access, record } = loaded
  if (isLocked(record.course.status) && !(await editsAsReviewer(access, record))) {
    return Response.json({ error: "This course is in review and can't be published. Withdraw it first." }, { status: 409 })
  }

  const result = await publishAndRecord(access, record.course)
  if ("error" in result) return Response.json({ error: result.error, code: result.code, issues: result.issues }, { status: result.status })
  return Response.json(result)
}
