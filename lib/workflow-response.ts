import type { Course } from "@/lib/course"
import type { WorkflowResult } from "@/lib/course-status"
import { publishCourse, PublishError, type PublishSummary } from "@/lib/course-publish"
import { recordPublish } from "@/lib/course-store"

/** Publishes the course to the platform database and notes when it happened. */
export async function publishAndRecord(
  course: Course,
): Promise<{ publishedAt: string; summary: PublishSummary } | { error: string; status: number }> {
  try {
    const summary = await publishCourse(course)
    const publishedAt = new Date().toISOString()
    await recordPublish(course.id, publishedAt)
    return { publishedAt, summary }
  } catch (error) {
    if (error instanceof PublishError) return { error: error.message, status: 409 }
    console.error(`Failed to publish course ${course.id}:`, error)
    return { error: `Couldn't publish to the database: ${(error as Error).message}`, status: 502 }
  }
}

/** Turns a workflow result into the JSON response every status route returns. */
export function workflowResponse(result: WorkflowResult | null) {
  if (!result) return Response.json({ error: "Course not found" }, { status: 404 })
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ course: result.course })
}

/**
 * For status changes (submit, withdraw, review): the new status is also
 * published so the platform sees it. The change itself stands even if
 * publishing fails; the response then carries `publishError`.
 */
export async function publishedWorkflowResponse(result: WorkflowResult | null) {
  if (!result || "error" in result) return workflowResponse(result)
  const published = await publishAndRecord(result.course)
  if ("error" in published) return Response.json({ course: result.course, publishError: published.error })
  return Response.json({ course: { ...result.course, published_at: published.publishedAt } })
}
