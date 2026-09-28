import { getCurrentUser } from "@/lib/auth"
import { submit } from "@/lib/course-status"
import { getAccessibleCourse, getCourseReport, updateCourseWorkflow } from "@/lib/course-store"
import { publishedWorkflowResponse } from "@/lib/workflow-response"

/** Submit a course for review (from draft, rejected or changes requested). */
export async function POST(_request: Request, ctx: RouteContext<"/api/courses/[courseId]/submit">) {
  const { courseId } = await ctx.params
  const user = await getCurrentUser()
  const course = await getAccessibleCourse(courseId, user)
  if (!course || course.owner_id !== user.id) return publishedWorkflowResponse(null)

  // Validate against the lesson files as they are now.
  const report = await getCourseReport(course)
  return publishedWorkflowResponse(await updateCourseWorkflow(courseId, (current) => submit(current, report, user.id)))
}
