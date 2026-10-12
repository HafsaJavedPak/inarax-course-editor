import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { ChangeRequestSchema } from "@/lib/course"
import { allowMoreResubmissions, review } from "@/lib/course-status"
import { updateCourseWorkflow } from "@/lib/course-store"
import { publishedWorkflowResponse } from "@/lib/workflow-response"

const ReviewSchema = z.object({
  // allow_resubmissions: not a decision; lifts the resubmission limit after a rejection.
  decision: z.enum(["approved", "rejected", "changes_requested", "allow_resubmissions"]),
  note: z.string().default(""),
  changes: z.array(ChangeRequestSchema.pick({ text: true, target: true })).default([]),
})

/**
 * A reviewer's decision on a course in review: accept, reject (note
 * required), or request changes (list required). Or `allow_resubmissions`,
 * once the author has used up their resubmissions after a rejection. Used by
 * the review area.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/courses/[courseId]/review">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.review")
  if (!loaded.ok) return loaded.error
  const { ctx: access } = loaded

  const parsed = ReviewSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Invalid review", issues: z.flattenError(parsed.error) }, { status: 400 })
  }

  const { decision, note, changes } = parsed.data
  return publishedWorkflowResponse(
    access,
    await updateCourseWorkflow(access, courseId, (current) =>
      decision === "allow_resubmissions"
        ? allowMoreResubmissions(current, access.userId)
        : review(current, decision, note, changes, access.userId),
    ),
  )
}
