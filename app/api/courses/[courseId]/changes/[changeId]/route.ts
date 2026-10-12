import { z } from "zod"

import { courseForRoute } from "@/lib/authz/context"
import { lastDecision } from "@/lib/course-status"
import { updateCourseWorkflow } from "@/lib/course-store"
import { workflowResponse } from "@/lib/workflow-response"

const PatchSchema = z.object({
  done: z.boolean().optional(),
  creator_note: z.string().max(2000).optional(),
})

/** Creator ticks off a requested change and/or adds a note about it. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/courses/[courseId]/changes/[changeId]">) {
  const { courseId, changeId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.submit")
  if (!loaded.ok) return loaded.error

  const parsed = PatchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: "Invalid update" }, { status: 400 })

  return workflowResponse(
    await updateCourseWorkflow(loaded.ctx, courseId, (current) => {
      // While changes are requested, or after withdrawing a resubmission (a
      // draft whose last decision was "changes requested"); never in review.
      if (current.status === "in_review" || lastDecision(current.review_history)?.status !== "changes_requested") {
        return { error: "Changes can only be updated while changes are requested.", status: 409 }
      }
      if (!current.change_requests.some((c) => c.id === changeId)) {
        return { error: "Requested change not found", status: 404 }
      }
      return {
        course: {
          ...current,
          change_requests: current.change_requests.map((c) => (c.id === changeId ? { ...c, ...parsed.data } : c)),
        },
      }
    })
  )
}
