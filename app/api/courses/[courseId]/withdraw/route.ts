import { getCurrentUser } from "@/lib/auth"
import { withdraw } from "@/lib/course-status"
import { getAccessibleCourse, updateCourseWorkflow } from "@/lib/course-store"
import { workflowResponse } from "@/lib/workflow-response"

/** Take a course out of review so it can be edited again. */
export async function POST(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/withdraw">) {
  const { courseId } = await ctx.params
  const user = await getCurrentUser()
  const course = await getAccessibleCourse(courseId, user)
  if (!course || course.owner_id !== user.id) return workflowResponse(null)

  return workflowResponse(await updateCourseWorkflow(courseId, (current) => withdraw(current, user.id)))
}
