import { z } from "zod"

import { courseForRoute, editsAsReviewer } from "@/lib/authz/context"
import type { CourseAction } from "@/lib/authz/policy"
import { findLessonRef, getCourseLimits } from "@/lib/course"
import { getLessonStats } from "@/lib/course-validate"
import {
  ApprovedLockedError,
  CourseLockedError,
  deleteLessonContent,
  LessonConflictError,
  readLessonRecord,
  saveLessonContent,
} from "@/lib/course-store"
import { isUuid, parseLesson } from "@/lib/lesson"

type Ctx = RouteContext<"/api/courses/[courseId]/lessons/[lessonId]">

const REVISION_HEADER = "X-Lesson-Revision"

const SaveSchema = z.object({
  /** The revision the editor loaded (0 for a lesson never saved). */
  expected_revision: z.number().int().nonnegative(),
  lesson: z.unknown(),
})

/** The course and how this request edits it, or an error Response if the lesson isn't in a course the user may use this way. */
async function loadCourseFor(ctx: Ctx, action: CourseAction) {
  const { courseId, lessonId } = await ctx.params
  if (!isUuid(courseId) || !isUuid(lessonId)) {
    return { error: Response.json({ error: "Invalid id" }, { status: 400 }) }
  }
  const loaded = await courseForRoute(courseId, action)
  if (!loaded.ok) return { error: loaded.error }
  const { ctx: access, record } = loaded
  if (!findLessonRef(record.course, lessonId)) {
    return { error: Response.json({ error: "Lesson not found in this course" }, { status: 404 }) }
  }
  const editor = { id: access.userId, asReviewer: await editsAsReviewer(access, record) }
  return { course: record.course, lessonId, access, editor }
}

export async function GET(_request: Request, ctx: Ctx) {
  const loaded = await loadCourseFor(ctx, "course.read")
  if (loaded.error) return loaded.error

  const saved = await readLessonRecord(loaded.access, loaded.course.id, loaded.lessonId)
  if (!saved) return Response.json({ error: "Lesson has no content yet" }, { status: 404 })
  // The body stays the plain lesson; its revision (needed to save) is in a header.
  return Response.json(saved.lesson, { headers: { [REVISION_HEADER]: String(saved.revision) } })
}


/**
 * Save lesson content. Body: `{ expected_revision, lesson }`, where
 * expected_revision is the revision the editor loaded. Returns the new
 * revision, fresh stats for the budget and the course's status (editing an
 * accepted course makes it a draft).
 *
 * 409 `revision_conflict` when someone saved the lesson in between: nothing
 * is written, and `current` holds what's stored now. 409 `course_locked`
 * while the course is in review (authors only).
 */
export async function PUT(request: Request, ctx: Ctx) {
  const loaded = await loadCourseFor(ctx, "course.edit")
  if (loaded.error) return loaded.error

  const body = SaveSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return Response.json(
      { error: "Expected { expected_revision, lesson }. Reload the page if this keeps happening." },
      { status: 400 },
    )
  }
  const parsed = parseLesson(body.data.lesson)
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const { course, revision } = await saveLessonContent(
      loaded.access,
      loaded.course.id,
      loaded.lessonId,
      parsed.lesson,
      body.data.expected_revision,
      loaded.editor,
    )
    const { words_per_minute } = getCourseLimits(course)
    return Response.json({
      id: loaded.lessonId,
      revision,
      stats: getLessonStats(parsed.lesson, words_per_minute),
      courseStatus: course.status,
    })
  } catch (error) {
    if (error instanceof LessonConflictError) {
      return Response.json(
        { error: error.message, code: "revision_conflict", current: error.current },
        { status: 409 },
      )
    }
    if (error instanceof CourseLockedError) {
      return Response.json({ error: error.message, code: "course_locked" }, { status: 409 })
    }
    if (error instanceof ApprovedLockedError) {
      return Response.json({ error: error.message, code: "approved_locked" }, { status: 409 })
    }
    console.error(`Failed to save lesson ${loaded.lessonId}:`, error)
    return Response.json({ error: "Failed to save lesson" }, { status: 500 })
  }
}

/** Delete a lesson's content (call before removing it from the course). Its earlier content stays in the history. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const loaded = await loadCourseFor(ctx, "course.edit")
  if (loaded.error) return loaded.error

  try {
    await deleteLessonContent(loaded.access, loaded.course.id, loaded.lessonId, loaded.editor)
  } catch (error) {
    if (error instanceof CourseLockedError || error instanceof ApprovedLockedError) {
      return Response.json({ error: error.message }, { status: 409 })
    }
    throw error
  }
  return new Response(null, { status: 204 })
}
