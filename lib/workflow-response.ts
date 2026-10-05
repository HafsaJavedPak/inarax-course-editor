import type { Course } from "@/lib/course"
import type { WorkflowResult } from "@/lib/course-status"
import { readCourseLesson, recordPublish } from "@/lib/course-store"
import type { Lesson } from "@/lib/lesson"
import { validateLesson } from "@/lib/lesson-validate"
import {
  getPlatform,
  PlatformError,
  PLATFORM_ERROR_STATUS,
  publishingEnabled,
  type PlatformErrorKind,
  type PublishSummary,
} from "@/lib/platform"

type PublishOutcome =
  | { publishedAt: string; summary: PublishSummary }
  | { error: string; status: number; code: PlatformErrorKind | "error" }

/** Publishes the course (with every saved lesson) to the platform and notes when it happened. */
export async function publishAndRecord(course: Course, actorId: string): Promise<PublishOutcome> {
  try {
    const platform = getPlatform()
    if (!platform) {
      throw new PlatformError("not_configured", "Publishing isn't set up for this editor (PLATFORM_ADAPTER is not set).")
    }

    // Only lessons that pass validation are sent. One with problems keeps its
    // last published version on the platform; the rest of the course still goes.
    const lessons = new Map<string, Lesson>()
    const skipped: string[] = []
    for (const ref of course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons))) {
      const lesson = await readCourseLesson(course.id, ref.id)
      if (!lesson) continue
      const errors = validateLesson(lesson).filter((i) => i.level === "error")
      if (errors.length) {
        const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : ""
        skipped.push(`“${ref.title}” wasn't published: ${errors[0].message}${more}. Fix it in the lesson editor.`)
      } else {
        lessons.set(ref.id, lesson)
      }
    }

    const published = await platform.publishCourse({ course, lessons, actorId })
    const summary = { ...published, warnings: [...skipped, ...published.warnings] }
    const publishedAt = new Date().toISOString()
    await recordPublish(course.id, publishedAt)
    if (summary.warnings.length) console.warn(`Published course ${course.id} with warnings:`, summary.warnings)
    return { publishedAt, summary }
  } catch (error) {
    if (error instanceof PlatformError) {
      if (error.kind === "unavailable" || error.kind === "auth") {
        console.error(`Failed to publish course ${course.id}:`, error.message, error.detail)
      }
      return { error: error.message, status: PLATFORM_ERROR_STATUS[error.kind], code: error.kind }
    }
    console.error(`Failed to publish course ${course.id}:`, error)
    return { error: `Couldn't publish: ${(error as Error).message}`, status: 500, code: "error" }
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
 * publishing fails; the response then carries `publishError`. With no
 * platform set up, only the local status changes.
 */
export async function publishedWorkflowResponse(result: WorkflowResult | null, actorId: string) {
  if (!result || "error" in result || !publishingEnabled()) return workflowResponse(result)
  const published = await publishAndRecord(result.course, actorId)
  if ("error" in published) return Response.json({ course: result.course, publishError: published.error })
  return Response.json({
    course: { ...result.course, published_at: published.publishedAt },
    warnings: published.summary.warnings,
  })
}
