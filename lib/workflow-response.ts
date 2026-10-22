import type { RequestContext } from "@/lib/authz/context"
import type { Course } from "@/lib/course"
import type { WorkflowResult } from "@/lib/course-status"
import { ApprovalMismatchError, findCourse, publishableContent, recordPublish } from "@/lib/course-store"
import { flushLiveCourse, LiveFlushError } from "@/lib/collab/live"
import { hostDepartmentId } from "@/lib/departments"
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
  | { error: string; status: number; code: PlatformErrorKind | "error"; issues?: string[] }

/**
 * Publishes the course (with every saved lesson) to the platform and notes
 * when it happened and which revision went. An accepted course publishes
 * exactly its accepted revision (lib/course-store.ts publishableContent).
 */
export async function publishAndRecord(ctx: RequestContext, course: Course): Promise<PublishOutcome> {
  const actor = ctx.user
  try {
    const platform = getPlatform()
    if (!platform) {
      throw new PlatformError("not_configured", "Publishing isn't set up for this editor (PLATFORM_ADAPTER is not set).")
    }

    // Only lessons that pass validation are sent. One with problems keeps its
    // last published version on the platform; the rest of the course still goes.
    // Live edits not yet stored go first, so what's published includes every acknowledged edit.
    await flushLiveCourse(course.id)
    const content = await publishableContent(ctx, course.id)
    if (!content) throw new Error("Course not found")
    const lessons = new Map<string, Lesson>()
    const skipped: string[] = []
    const saved = content.lessons
    for (const ref of content.course.levels.flatMap((l) => l.modules.flatMap((m) => m.lessons))) {
      const lesson = saved.get(ref.id)
      if (!lesson) continue
      const errors = validateLesson(lesson).filter((i) => i.level === "error")
      if (errors.length) {
        const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : ""
        skipped.push(`“${ref.title}” wasn't published: ${errors[0].message}${more}. Fix it in the lesson editor.`)
      } else {
        lessons.set(ref.id, lesson)
      }
    }

    // The course lands in the host organization of its workspace (personal workspaces: the host's default).
    const record = await findCourse(ctx, course.id)
    const organization = record?.tenantHostOrgId ? { hostOrgId: record.tenantHostOrgId } : null
    // And in the host's department for it, when the course is in one.
    const departmentHostId = await hostDepartmentId(record?.departmentId ?? null)
    const department = departmentHostId ? { hostDepartmentId: departmentHostId } : null
    const published = await platform.publishCourse({
      course: content.course,
      lessons,
      actor: { id: actor.id, name: actor.name, email: actor.email },
      organization,
      department,
    })
    const summary = { ...published, warnings: [...skipped, ...published.warnings] }
    const publishedAt = new Date().toISOString()
    await recordPublish(ctx, course.id, publishedAt, content.revisionId)
    if (summary.warnings.length) console.warn(`Published course ${course.id} with warnings:`, summary.warnings)
    return { publishedAt, summary }
  } catch (error) {
    if (error instanceof LiveFlushError) {
      return { error: error.message, status: 503, code: "unavailable" }
    }
    if (error instanceof ApprovalMismatchError) {
      return { error: error.message, status: 409, code: "error" }
    }
    if (error instanceof PlatformError) {
      if (error.kind === "unavailable" || error.kind === "auth") {
        console.error(`Failed to publish course ${course.id}:`, error.message, error.detail)
      }
      return { error: error.message, status: PLATFORM_ERROR_STATUS[error.kind], code: error.kind, issues: error.issues }
    }
    console.error(`Failed to publish course ${course.id}:`, error)
    return { error: `Couldn't publish: ${(error as Error).message}`, status: 500, code: "error" }
  }
}

/** Turns a workflow result into the JSON response every status route returns. */
export function workflowResponse(result: WorkflowResult | null) {
  if (!result) return Response.json({ error: "Course not found" }, { status: 404 })
  if ("error" in result) {
    return Response.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.detail !== undefined ? { detail: result.detail } : {}) },
      { status: result.status },
    )
  }
  return Response.json({ course: result.course })
}

/**
 * For status changes (submit, withdraw, review): the new status is also
 * published so the platform sees it. The change itself stands even if
 * publishing fails; the response then carries `publishError`. With no
 * platform set up, only the local status changes.
 */
export async function publishedWorkflowResponse(ctx: RequestContext, result: WorkflowResult | null) {
  if (!result || "error" in result || !publishingEnabled()) return workflowResponse(result)
  const published = await publishAndRecord(ctx, result.course)
  if ("error" in published) {
    return Response.json({ course: result.course, publishError: published.error, publishIssues: published.issues })
  }
  return Response.json({
    course: { ...result.course, published_at: published.publishedAt },
    warnings: published.summary.warnings,
  })
}
