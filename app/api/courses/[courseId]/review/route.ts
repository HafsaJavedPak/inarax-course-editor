import { z } from "zod"

import { flushLiveCourse, LiveFlushError } from "@/lib/collab/live"
import { courseForRoute, resourceOf } from "@/lib/authz/context"
import { can } from "@/lib/authz/policy"
import { ChangeRequestSchema } from "@/lib/course"
import { allowMoreResubmissions, canReview, review, takedown } from "@/lib/course-status"
import { decisionStage, pipelineTenant, stageAction } from "@/lib/review/pipeline"
import { decideReview, takeDownCourse, updateCourseWorkflow } from "@/lib/course-store"
import { publishedWorkflowResponse } from "@/lib/workflow-response"

const ReviewSchema = z.object({
  // allow_resubmissions: not a decision; lifts the resubmission limit after a rejection.
  // takedown: not a stage decision; takes a live course down from the catalogue.
  decision: z.enum(["approved", "rejected", "changes_requested", "allow_resubmissions", "takedown"]),
  note: z.string().default(""),
  changes: z.array(ChangeRequestSchema.pick({ text: true, target: true })).default([]),
  /** What the reviewer saw (the review page sends the course's head revision): decisions are bound to it. */
  revision_id: z.uuid().optional(),
  content_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
})

const forbidden = () => Response.json({ error: "You don't have permission to do that." }, { status: 403 })

/**
 * A reviewer's decision, at the stage the course is waiting on (lib/review/pipeline.ts):
 * the organization stage is decided by an org admin of that organization (or platform
 * staff), the platform stage by platform staff. A decision must name the
 * `revision_id` and `content_hash` the reviewer saw; if the course changed
 * since, nothing is decided (409 content_changed). `allow_resubmissions` lifts
 * the resubmission limit after a rejection; `takedown` takes a live course
 * down from the catalogue.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/courses/[courseId]/review">) {
  const { courseId } = await ctx.params
  const loaded = await courseForRoute(courseId, "course.read")
  if (!loaded.ok) return loaded.error
  const { ctx: access, record } = loaded
  const resource = resourceOf(record)

  const parsed = ReviewSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: "Invalid review", issues: z.flattenError(parsed.error) }, { status: 400 })
  }
  const { decision, note, changes, revision_id, content_hash } = parsed.data

  // Not a stage decision: a reviewer lifts the resubmission limit after a rejection.
  if (decision === "allow_resubmissions") {
    if (!can(access, "course.review", resource)) return forbidden()
    return publishedWorkflowResponse(
      access,
      await updateCourseWorkflow(access, courseId, (current) => allowMoreResubmissions(current, access.userId)),
    )
  }

  // Not a stage decision either: taking a live course down from the catalogue.
  if (decision === "takedown") {
    if (!can(access, "course.takedown", resource)) return forbidden()
    return publishedWorkflowResponse(access, await takeDownCourse(access, courseId, access.userId, (current) => takedown(current, access.userId, note)))
  }

  const tenant = pipelineTenant({ kind: record.tenantKind, settings: record.settings })
  const stage = canReview(record.course.status)
    ? decisionStage(record.course.status, tenant, {
        review: can(access, "course.review", resource),
        release: can(access, "course.release", resource),
      })
    : null
  if (!stage) return Response.json({ error: "This course isn't waiting for a review decision." }, { status: 409 })
  if (!can(access, stageAction(stage), resource)) return forbidden()

  // Live edits not yet stored go first: decisions and submissions are about the stored content.
  try {
    await flushLiveCourse(courseId)
  } catch (error) {
    if (error instanceof LiveFlushError) return Response.json({ error: error.message }, { status: 503 })
    throw error
  }
  if (!revision_id || !content_hash) {
    return Response.json(
      { error: "A decision must say which version was reviewed (revision_id and content_hash). Reload the review page." },
      { status: 400 },
    )
  }
  return publishedWorkflowResponse(
    access,
    await decideReview(access, courseId, access.userId, stage, decision, { revisionId: revision_id, contentHash: content_hash }, (current) =>
      review(current, stage, tenant, decision, note, changes, access.userId),
    ),
  )
}
