import { courseForRoute } from "@/lib/authz/context"
import { withdraw } from "@/lib/course-status"
import { updateCourseWorkflow } from "@/lib/course-store"
import { publishedWorkflowResponse } from "@/lib/workflow-response"

/** Take a course out of review so it can be edited again. Only its author can. */
export async function POST(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/withdraw">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.submit")
  if (!loaded.ok) return loaded.error
  const { ctx: access } = loaded

  return publishedWorkflowResponse(access, await updateCourseWorkflow(access, courseId, (current) => withdraw(current, access.userId)))
}
