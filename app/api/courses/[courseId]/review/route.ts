import { z } from "zod"

import { getCurrentUser } from "@/lib/auth"
import { ChangeRequestSchema } from "@/lib/course"
import { review } from "@/lib/course-status"
import { updateCourseWorkflow } from "@/lib/course-store"
import { publishedWorkflowResponse } from "@/lib/workflow-response"

const ReviewSchema = z.object({
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  note: z.string().default(""),
  changes: z.array(ChangeRequestSchema.pick({ text: true, target: true })).default([]),
})

/**
 * Admin decision on a course in review: accept, reject (note required), or
 * request changes (list required). Used by the admin dashboard.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/courses/[courseId]/review">) {
  const user = await getCurrentUser()
  if (user.role !== "admin") return Response.json({ error: "Only admins can review courses" }, { status: 403 })

  const parsed = ReviewSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Invalid review", issues: z.flattenError(parsed.error) }, { status: 400 })
  }

  const { courseId } = await ctx.params
  const { decision, note, changes } = parsed.data
  return publishedWorkflowResponse(
    await updateCourseWorkflow(courseId, (current) => review(current, decision, note, changes, user.id)),
    user,
  )
}
