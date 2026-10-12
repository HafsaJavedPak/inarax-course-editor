import { z } from "zod"

import { flushLiveCourse, LiveFlushError } from "@/lib/collab/live"
import { courseForRoute } from "@/lib/authz/context"
import { ChangeRequestSchema } from "@/lib/course"
import { allowMoreResubmissions, review } from "@/lib/course-status"
import { decideReview, updateCourseWorkflow } from "@/lib/course-store"
import { publishedWorkflowResponse } from "@/lib/workflow-response"

const ReviewSchema = z.object({
  // allow_resubmissions: not a decision; lifts the resubmission limit after a rejection.
  decision: z.enum(["approved", "rejected", "changes_requested", "allow_resubmissions"]),
  note: z.string().default(""),
  changes: z.array(ChangeRequestSchema.pick({ text: true, target: true })).default([]),
  /** What the reviewer saw (the review page sends the course's head revision): decisions are bound to it. */
  revision_id: z.uuid().optional(),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
})

/**
 * A reviewer's decision on a course in review: accept, reject (note
 * required), or request changes (list required). A decision must name the
 * `revision_id` and `content_hash` the reviewer saw; if the course changed
 * since, nothing is decided (409 content_changed). Or `allow_resubmissions`,
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

  // Live edits not yet stored go first: decisions and submissions are about the stored content.
  try {
    await flushLiveCourse(courseId)
  } catch (error) {
    if (error instanceof LiveFlushError) return Response.json({ error: error.message }, { status: 503 })
    throw error
  }
  const { decision, note, changes, revision_id, content_hash } = parsed.data
  if (decision === "allow_resubmissions") {
    return publishedWorkflowResponse(
      access,
      await updateCourseWorkflow(access, courseId, (current) => allowMoreResubmissions(current, access.userId)),
    )
  }
  if (!revision_id || !content_hash) {
    return Response.json(
      { error: "A decision must say which version was reviewed (revision_id and content_hash). Reload the review page." },
      { status: 400 },
    )
  }
  return publishedWorkflowResponse(
    access,
    await decideReview(access, courseId, access.userId, decision, { revisionId: revision_id, contentHash: content_hash }, (current) =>
      review(current, decision, note, changes, access.userId),
    ),
  )
}
